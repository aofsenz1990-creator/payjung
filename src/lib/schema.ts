// โครงสร้างตารางทั้งหมด — รันซ้ำได้เสมอ (IF NOT EXISTS) จึงใช้เป็น migration ในตัวได้
//
// การล็อกอินใช้ Supabase Auth ตัวผู้ใช้จริงเก็บอยู่ในตาราง auth.users ของ Supabase
// ส่วนตาราง profiles ด้านล่างเก็บข้อมูลฝั่งร้าน (ชื่อที่แสดง / สิทธิ์ / เปิด-ปิดการใช้งาน)
// โดยใช้ id เดียวกับ auth.users.id

export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists profiles (
    id uuid primary key,
    email text,
    display_name text not null default '',
    role text not null default 'staff',
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )`,

  // สิทธิ์เข้าถึงเมนูรายคน — null = ใช้ค่าเริ่มต้นตามสิทธิ์ (ดู src/lib/pages.ts)
  `alter table profiles add column if not exists allowed_pages text[]`,

  // ผู้ให้บริการเติมเกมที่ต่อ API ไว้ — รองรับหลายเจ้าพร้อมกัน
  // แต่ละแพ็กเกจเลือกได้ว่าจะให้เจ้าไหนเป็นคนเติมให้
  // ต้องสร้างก่อนตาราง products เพราะ products อ้างถึงตารางนี้
  `create table if not exists api_providers (
    id serial primary key,
    name text not null,
    base_url text,
    auth_type text not null default 'bearer',
    api_key text,
    note text,
    priority int not null default 100,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists api_providers_name_uniq on api_providers (lower(name))`,
  // ชนิดของ API เพื่อให้รู้ว่าต้องคุยด้วยรูปแบบไหน เช่น '24buym'
  `alter table api_providers add column if not exists kind text not null default 'custom'`,
  // ผู้ให้บริการบางเจ้าใช้ ID + รหัสผ่าน ไม่ใช่คีย์เดี่ยวแบบ 24BUYM
  // (รหัสผ่านเก็บในคอลัมน์ api_key เดิม จะได้ไม่ต้องมีสองที่)
  `alter table api_providers add column if not exists username text`,
  // ยอดเงิน/พอยต์คงเหลือของร้านที่ผู้ให้บริการ — แคชไว้ไม่ต้องยิงถามทุกครั้งที่เปิดหน้า
  `alter table api_providers add column if not exists balance numeric(12,2)`,
  `alter table api_providers add column if not exists balance_at timestamptz`,
  // ต่ำกว่านี้ให้ขึ้นเตือนบนหน้าจอ (0 = ไม่เตือน)
  `alter table api_providers add column if not exists low_balance numeric(12,2) not null default 0`,
  // ยิงเข้าสภาพแวดล้อมทดสอบของผู้ให้บริการแทนของจริง — ใช้ซ้อมทั้งกระบวนการโดยไม่เสียเงิน
  `alter table api_providers add column if not exists sandbox boolean not null default false`,

  `create table if not exists games (
    id serial primary key,
    name text not null,
    publisher text,
    note text,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists games_name_uniq on games (lower(name))`,

  // ข้อมูลสำหรับหน้าเว็บที่ลูกค้าจะเข้ามาสั่งซื้อเอง (ยังไม่เปิดใช้)
  `alter table games add column if not exists image_url text`,
  `alter table games add column if not exists description text`,
  `alter table games add column if not exists is_published boolean not null default false`,
  `alter table games add column if not exists sort_order int not null default 100`,

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

  // การตั้งค่าของแพ็กเกจสำหรับหน้าเว็บลูกค้า + ผูกกับผู้ให้บริการ API ที่จะเติมให้
  `alter table products add column if not exists image_url text`,
  `alter table products add column if not exists is_published boolean not null default false`,
  `alter table products add column if not exists sort_order int not null default 100`,
  `alter table products add column if not exists provider_id int references api_providers(id) on delete set null`,
  `alter table products add column if not exists provider_sku text`,
  // รหัสเกมและเซิร์ฟเวอร์ฝั่งผู้ให้บริการ (24BUYM ต้องใช้ครบทั้งสามค่าตอนสั่งเติม)
  `alter table products add column if not exists provider_game_id text`,
  `alter table products add column if not exists provider_server_id text not null default '0'`,
  // ชนิดสินค้าฝั่งผู้ให้บริการ — OverTopup แยก gtopup_uid / card ซึ่งส่งพารามิเตอร์คนละชุด
  `alter table products add column if not exists provider_product_type text`,
  // บวกกำไรเป็นเปอร์เซ็นต์จากต้นทุน — ตั้งไว้แล้วราคาขายจะคำนวณให้เองทุกครั้งที่ต้นทุนเปลี่ยน
  // null = ตั้งราคาขายเอง ระบบไม่ยุ่ง
  `alter table products add column if not exists markup_percent numeric(6,2)`,
  // สำเนาของ provider_catalog.fields ตอนนำเข้า — หน้าเว็บลูกค้าใช้สร้างช่องกรอก
  `alter table products add column if not exists provider_fields jsonb`,
  // ชื่อสินค้าฝั่งผู้ให้บริการ ใช้แยก "ประเภท" ของเกมเดียวกัน
  // เช่นเกมเดียวแต่มีทั้ง OneOne THB / OneOne MYR / GOC ซึ่งเติมคนละแบบและใช้ช่องกรอกคนละชุด
  // เอาไว้ให้ลูกค้าเลือกในหน้าเดียว แทนที่จะแยกเป็นคนละเกม
  `alter table products add column if not exists provider_variant text`,

  // รายการสินค้าที่ดึงมาจากผู้ให้บริการ เก็บไว้ให้เลือกจับคู่โดยไม่ต้องยิง API ซ้ำ
  `create table if not exists provider_catalog (
    id serial primary key,
    provider_id int not null references api_providers(id) on delete cascade,
    game_id text not null,
    game_name text not null,
    server_id text not null default '0',
    server_name text,
    pack_code text not null,
    pack_name text not null,
    pack_desc text,
    pack_price numeric(12,2) not null default 0,
    synced_at timestamptz not null default now()
  )`,
  `create unique index if not exists provider_catalog_uniq
     on provider_catalog (provider_id, game_id, server_id, pack_code)`,
  // ช่องที่เกมนั้นบังคับให้กรอกตอนสั่งเติม เช่น uid, server (บางเกมต้องเลือกภูมิภาค)
  // เก็บทั้งชื่อช่อง ป้ายกำกับ และตัวเลือกที่มีให้เลือก ตามที่ผู้ให้บริการส่งมา
  `alter table provider_catalog add column if not exists fields jsonb`,
  // ชนิดสินค้ารายแพ็ก (uid / card / idpass) — ต่างกันได้ในผู้ให้บริการเดียวกัน
  // และใช้ path คนละอันตอนสั่ง ถ้าตั้งเหมือนกันหมดบัตรเงินสดจะถูกส่งผิดที่
  `alter table provider_catalog add column if not exists product_type text`,
  `create index if not exists provider_catalog_game_idx on provider_catalog (provider_id, game_name)`,

  `create table if not exists customers (
    id serial primary key,
    name text not null,
    phone text,
    contact text,
    game_uid text,
    note text,
    created_at timestamptz not null default now()
  )`,

  // ระบบเครดิต — ร้านเป็นคนเติมเครดิตให้ลูกค้าเอง แล้วลูกค้าใช้เครดิตกดซื้อบนหน้าเว็บ
  `alter table customers add column if not exists credit numeric(12,2) not null default 0`,
  // ผูกกับบัญชี Supabase Auth เพื่อให้ลูกค้าเข้าเว็บได้ (ร้านเป็นคนสร้างบัญชีให้)
  `alter table customers add column if not exists auth_user_id uuid`,
  `alter table customers add column if not exists web_enabled boolean not null default false`,
  `create unique index if not exists customers_auth_uniq
     on customers (auth_user_id) where auth_user_id is not null`,

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
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  )`,
  // ที่อยู่ไฟล์สลิปโอนเงินใน Supabase Storage (bucket "slips")
  `alter table sales add column if not exists slip_path text`,

  // ชื่อลูกค้าที่พิมพ์เอง ใช้เมื่อไม่ได้เลือกจากรายชื่อลูกค้าที่มีอยู่
  `alter table sales add column if not exists customer_name text`,
  // ลูกค้ามาจากช่องทางไหน เช่น Facebook, LINE, หน้าร้าน
  `alter table sales add column if not exists source text`,
  `create index if not exists sales_source_idx on sales (source)`,
  // บิลนี้มาจากไหน: shop = พนักงานลงเอง, web = ลูกค้ากดซื้อเองบนหน้าเว็บ
  `alter table sales add column if not exists channel text not null default 'shop'`,

  // ── การส่งออเดอร์ต่อไปยังผู้ให้บริการ API ──
  // provider_state: null = ไม่ต้องส่ง (ลงมือเอง), queued = รอส่ง, sending = กำลังส่ง (ล็อกกันส่งซ้ำ),
  //                 sent = ปลายทางรับเข้าคิวแล้ว, success = เติมสำเร็จ,
  //                 failed = ปลายทางแจ้งล้มเหลว (คืนเครดิตแล้ว), error = ส่งไม่ออก ต้องให้คนดู
  `alter table sales add column if not exists provider_id int references api_providers(id) on delete set null`,
  `alter table sales add column if not exists provider_state text`,
  `alter table sales add column if not exists provider_order_id text`,
  `alter table sales add column if not exists provider_message text`,
  `alter table sales add column if not exists provider_attempts int not null default 0`,
  `alter table sales add column if not exists provider_sent_at timestamptz`,
  `alter table sales add column if not exists provider_checked_at timestamptz`,
  // เลขอ้างอิงที่ส่งไปให้ปลายทาง (ใช้เลขบิลของเรา) — บังคับไม่ซ้ำระดับฐานข้อมูล
  // เป็นด่านสุดท้ายกันเติมสองรอบ ถ้าโค้ดพลาดขึ้นมาจริง ๆ
  `alter table sales add column if not exists provider_ref text`,
  // ค่าที่ลูกค้ากรอกตามช่องที่เกมนั้นบังคับ เช่น {"uid":"123","server":"1"}
  // ต้องเก็บไว้กับบิล เพราะตอนส่งซ้ำหรือตามสถานะทีหลังต้องใช้ค่าชุดเดิมเป๊ะ
  `alter table sales add column if not exists provider_fields jsonb`,
  `create unique index if not exists sales_provider_ref_uniq
     on sales (provider_ref) where provider_ref is not null`,
  `create index if not exists sales_provider_state_idx
     on sales (provider_state) where provider_state is not null`,

  // สมุดบัญชีเครดิตของลูกค้า ทุกการเปลี่ยนแปลงต้องมีบรรทัดบันทึกไว้เสมอ
  `create table if not exists credit_transactions (
    id serial primary key,
    customer_id int not null references customers(id) on delete cascade,
    kind text not null,
    amount numeric(12,2) not null,
    balance_after numeric(12,2) not null,
    note text,
    sale_id int references sales(id) on delete set null,
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists credit_tx_customer_idx
     on credit_transactions (customer_id, created_at desc)`,

  // ข่าวสารที่แสดงด้านล่างหน้าเว็บ
  `create table if not exists news (
    id serial primary key,
    title text not null,
    body text,
    image_url text,
    link_url text,
    is_published boolean not null default true,
    pinned boolean not null default false,
    created_at timestamptz not null default now()
  )`,

  // คำขอเติมเครดิต — ลูกค้าโอนเงินแล้วแจ้งพร้อมสลิป รอร้านกดอนุมัติ
  `create table if not exists credit_requests (
    id serial primary key,
    customer_id int not null references customers(id) on delete cascade,
    amount numeric(12,2) not null default 0,
    slip_path text,
    note text,
    status text not null default 'pending',
    reject_reason text,
    reviewed_by uuid references profiles(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists credit_requests_status_idx
     on credit_requests (status, created_at desc)`,

  // รายการเคลม — เติมเกมให้ไม่สำเร็จแล้วต้องโอนเงินคืนลูกค้า
  `create table if not exists claims (
    id serial primary key,
    customer_id int references customers(id) on delete set null,
    customer_name text not null,
    contact_channel text,
    contact_value text,
    amount numeric(12,2) not null default 0,
    game_id int references games(id) on delete set null,
    game_name text,
    sale_id int references sales(id) on delete set null,
    slip_path text,
    note text,
    status text not null default 'pending',
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    paid_at timestamptz
  )`,
  `create index if not exists claims_status_idx on claims (status, created_at desc)`,

  // ค่าตั้งค่าทั่วไปของหน้าเว็บ เช่น ช่องทางติดต่อ ข้อความประกาศ
  `create table if not exists site_settings (
    key text primary key,
    value text
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
    created_by uuid references profiles(id) on delete set null,
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
    created_by uuid references profiles(id) on delete set null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists expenses_spent_on_idx on expenses (spent_on desc)`,

  // เก็บกวาดผลจากบั๊กเก่า: ลูกค้าที่ล็อกอินหน้าเว็บเคยถูกสร้างเป็น "พนักงาน" อัตโนมัติ
  // ลบเฉพาะแถวที่เป็น staff และผูกกับบัญชีลูกค้าอยู่ ไม่แตะบัญชีผู้ดูแลระบบ
  // บิลที่เคยบันทึกไว้ไม่หาย เพราะ sales.created_by ตั้งเป็น on delete set null
  `delete from profiles p
    where p.role = 'staff'
      and exists (select 1 from customers c where c.auth_user_id = p.id)`,

  // ตารางทั้งหมดถูกอ่าน/เขียนผ่านเซิร์ฟเวอร์ของแอปด้วย connection string โดยตรงเท่านั้น
  // เปิด RLS ไว้โดยไม่สร้าง policy เพื่อกันไม่ให้ anon key ของ Supabase แตะข้อมูลได้เลย
  `alter table profiles enable row level security`,
  `alter table games enable row level security`,
  `alter table products enable row level security`,
  `alter table customers enable row level security`,
  `alter table sales enable row level security`,
  `alter table stock_movements enable row level security`,
  `alter table expenses enable row level security`,
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
