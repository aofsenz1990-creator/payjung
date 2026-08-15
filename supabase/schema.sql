-- Pay Jung — โครงสร้างฐานข้อมูลทั้งหมด
--
-- ไฟล์นี้สร้างจาก src/lib/schema.ts ซึ่งเป็นต้นฉบับจริงที่แอปใช้
-- ปกติ "ไม่ต้องรันเอง" เพราะแอปสร้างตารางให้อัตโนมัติตอนต่อฐานข้อมูลครั้งแรก
--
-- ทุกคำสั่งเป็นแบบรันซ้ำได้ (IF NOT EXISTS) จึงวางรันกี่ครั้งก็ไม่พัง
create table if not exists profiles (
    id uuid primary key,
    email text,
    display_name text not null default '',
    role text not null default 'staff',
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

alter table profiles add column if not exists allowed_pages text[];

create table if not exists api_providers (
    id serial primary key,
    name text not null,
    base_url text,
    auth_type text not null default 'bearer',
    api_key text,
    note text,
    priority int not null default 100,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

create unique index if not exists api_providers_name_uniq on api_providers (lower(name));

alter table api_providers add column if not exists kind text not null default 'custom';

create table if not exists games (
    id serial primary key,
    name text not null,
    publisher text,
    note text,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

create unique index if not exists games_name_uniq on games (lower(name));

alter table games add column if not exists image_url text;

alter table games add column if not exists description text;

alter table games add column if not exists is_published boolean not null default false;

alter table games add column if not exists sort_order int not null default 100;

create table if not exists products (
    id serial primary key,
    game_id int not null references games(id) on delete cascade,
    name text not null,
    sku text,
    cost_price numeric(12,2) not null default 0,
    sell_price numeric(12,2) not null default 0,
    track_stock boolean not null default false,
    stock_qty int not null default 0,
    low_stock int not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

create index if not exists products_game_idx on products (game_id);

alter table products add column if not exists image_url text;

alter table products add column if not exists is_published boolean not null default false;

alter table products add column if not exists sort_order int not null default 100;

alter table products add column if not exists provider_id int references api_providers(id) on delete set null;

alter table products add column if not exists provider_sku text;

create table if not exists customers (
    id serial primary key,
    name text not null,
    phone text,
    contact text,
    game_uid text,
    note text,
    created_at timestamptz not null default now()
  );

alter table customers add column if not exists credit numeric(12,2) not null default 0;

alter table customers add column if not exists auth_user_id uuid;

alter table customers add column if not exists web_enabled boolean not null default false;

create unique index if not exists customers_auth_uniq
     on customers (auth_user_id) where auth_user_id is not null;

create table if not exists sales (
    id serial primary key,
    code text not null unique,
    sold_at timestamptz not null default now(),
    customer_id int references customers(id) on delete set null,
    game_id int references games(id) on delete set null,
    product_id int references products(id) on delete set null,
    item_name text not null,
    game_account text,
    qty int not null default 1,
    unit_price numeric(12,2) not null default 0,
    unit_cost numeric(12,2) not null default 0,
    total numeric(12,2) not null default 0,
    cost_total numeric(12,2) not null default 0,
    profit numeric(12,2) not null default 0,
    payment_method text not null default 'เงินสด',
    status text not null default 'paid',
    note text,
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );

alter table sales add column if not exists slip_path text;

alter table sales add column if not exists customer_name text;

alter table sales add column if not exists source text;

create index if not exists sales_source_idx on sales (source);

alter table sales add column if not exists channel text not null default 'shop';

create table if not exists credit_transactions (
    id serial primary key,
    customer_id int not null references customers(id) on delete cascade,
    kind text not null,
    amount numeric(12,2) not null,
    balance_after numeric(12,2) not null,
    note text,
    sale_id int references sales(id) on delete set null,
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );

create index if not exists credit_tx_customer_idx
     on credit_transactions (customer_id, created_at desc);

create table if not exists news (
    id serial primary key,
    title text not null,
    body text,
    image_url text,
    link_url text,
    is_published boolean not null default true,
    pinned boolean not null default false,
    created_at timestamptz not null default now()
  );

create table if not exists site_settings (
    key text primary key,
    value text
  );

create index if not exists sales_sold_at_idx on sales (sold_at desc);

create index if not exists sales_customer_idx on sales (customer_id);

create index if not exists sales_game_idx on sales (game_id);

create table if not exists stock_movements (
    id serial primary key,
    product_id int not null references products(id) on delete cascade,
    kind text not null,
    qty int not null,
    unit_cost numeric(12,2) not null default 0,
    note text,
    sale_id int references sales(id) on delete set null,
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );

create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc);

create table if not exists expenses (
    id serial primary key,
    spent_on date not null,
    category text not null,
    title text not null,
    amount numeric(12,2) not null default 0,
    note text,
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  );

create index if not exists expenses_spent_on_idx on expenses (spent_on desc);

alter table profiles enable row level security;

alter table games enable row level security;

alter table products enable row level security;

alter table customers enable row level security;

alter table sales enable row level security;

alter table stock_movements enable row level security;

alter table expenses enable row level security;

-- เกมยอดนิยมที่ใส่ให้ตั้งต้น (ลบทิ้งได้)
insert into games (name, publisher) values ('Free Fire', 'Garena') on conflict do nothing;
insert into games (name, publisher) values ('RoV / Arena of Valor', 'Garena') on conflict do nothing;
insert into games (name, publisher) values ('PUBG Mobile', 'Tencent') on conflict do nothing;
insert into games (name, publisher) values ('Roblox', 'Roblox Corp') on conflict do nothing;
insert into games (name, publisher) values ('Genshin Impact', 'HoYoverse') on conflict do nothing;
insert into games (name, publisher) values ('Honkai: Star Rail', 'HoYoverse') on conflict do nothing;
insert into games (name, publisher) values ('Mobile Legends', 'Moonton') on conflict do nothing;
insert into games (name, publisher) values ('Valorant', 'Riot Games') on conflict do nothing;
