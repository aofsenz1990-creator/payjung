/**
 * ค่าคงที่ของผู้ให้บริการ API ที่ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์ใช้ร่วมกัน
 * แยกออกมาจาก 24buym.ts เพราะไฟล์นั้นเป็น server-only
 */
export const BUYM_DEFAULT_BASE = 'https://new-api.24buymseller.com'

/**
 * ทะเบียนชนิดผู้ให้บริการที่ระบบรู้จัก
 *
 * เพิ่มเจ้าใหม่: เติมรายการที่นี่หนึ่งบรรทัด แล้วเขียน adapter ใน providers/registry.ts
 * ฟอร์มเพิ่มผู้ให้บริการจะปรับช่องกรอกตามค่าที่ใส่ไว้นี้ให้เอง
 */
export type ProviderKindMeta = {
  kind: string
  label: string
  /** เจ้านี้ใช้ ID + รหัสผ่าน (ถ้า false = ใช้คีย์เดี่ยว) */
  needsUsername: boolean
  /** ที่อยู่ API ตายตัว ถ้ามีจะล็อกช่องกรอกไว้ให้ */
  fixedBaseUrl?: string
  /** ต่ออัตโนมัติได้จริงแล้วหรือยัง (false = เก็บข้อมูลไว้ก่อน ยังส่งออเดอร์ไม่ได้) */
  autoSupported: boolean
  /** ชื่อหน่วยเงินที่เจ้านั้นใช้เรียก */
  unit: string
}

export const PROVIDER_KIND_META: ProviderKindMeta[] = [
  {
    kind: '24buym',
    label: '24BUYM (ต่ออัตโนมัติได้)',
    needsUsername: false,
    fixedBaseUrl: BUYM_DEFAULT_BASE,
    autoSupported: true,
    unit: 'พอยต์',
  },
  {
    kind: 'userpass',
    label: 'เจ้าอื่นที่ใช้ ID + รหัสผ่าน (เก็บข้อมูลไว้ก่อน)',
    needsUsername: true,
    autoSupported: false,
    unit: 'บาท',
  },
  {
    kind: 'custom',
    label: 'เจ้าอื่นที่ใช้คีย์ (เก็บข้อมูลไว้ก่อน)',
    needsUsername: false,
    autoSupported: false,
    unit: 'บาท',
  },
]

export const PROVIDER_KINDS = PROVIDER_KIND_META.map((m) => m.kind)

export function providerMeta(kind: string): ProviderKindMeta {
  return PROVIDER_KIND_META.find((m) => m.kind === kind) ?? PROVIDER_KIND_META[2]
}
