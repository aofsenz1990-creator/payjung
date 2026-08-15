// โครงสร้างตารางทั้งหมด — รันซ้ำได้เสมอ (IF NOT EXISTS) จึงใช้เป็น migration ในตัวได้
// Neon HTTP ยิงได้ทีละ statement เท่านั้น จึงต้องแยกเป็น array

export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists users (
    id serial primary key,
    username text not null unique,
    password_hash text not null,
    display_name text not null,
    role text not null default 'staff',
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )`,

  `create table if not exists games (
    id serial primary key,
    name text not null,
    publisher text,
    note text,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists games_name_uniq on games (lower(name))`,

  `create table if not exists products (
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
  )`,
  `create index if not exists products_game_idx on products (game_id)`,

  `create table if not exists customers (
    id serial primary key,
    name text not null,
    phone text,
    contact text,
    game_uid text,
    note text,
    created_at timestamptz not null default now()
  )`,

  `create table if not exists sales (
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
    created_by int references users(id) on delete set null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists sales_sold_at_idx on sales (sold_at desc)`,
  `create index if not exists sales_customer_idx on sales (customer_id)`,
  `create index if not exists sales_game_idx on sales (game_id)`,

  `create table if not exists stock_movements (
    id serial primary key,
    product_id int not null references products(id) on delete cascade,
    kind text not null,
    qty int not null,
    unit_cost numeric(12,2) not null default 0,
    note text,
    sale_id int references sales(id) on delete set null,
    created_by int references users(id) on delete set null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc)`,

  `create table if not exists expenses (
    id serial primary key,
    spent_on date not null,
    category text not null,
    title text not null,
    amount numeric(12,2) not null default 0,
    note text,
    created_by int references users(id) on delete set null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists expenses_spent_on_idx on expenses (spent_on desc)`,
]

// เกมยอดนิยมที่ใส่ให้ตอนตั้งค่าครั้งแรก เพื่อไม่ต้องเริ่มจากหน้าว่าง
export const SEED_GAMES: Array<[string, string]> = [
  ['Free Fire', 'Garena'],
  ['RoV / Arena of Valor', 'Garena'],
  ['PUBG Mobile', 'Tencent'],
  ['Roblox', 'Roblox Corp'],
  ['Genshin Impact', 'HoYoverse'],
  ['Honkai: Star Rail', 'HoYoverse'],
  ['Mobile Legends', 'Moonton'],
  ['Valorant', 'Riot Games'],
]
