/**
 * ค่าคงที่ของผู้ให้บริการ API ที่ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์ใช้ร่วมกัน
 * แยกออกมาจาก 24buym.ts เพราะไฟล์นั้นเป็น server-only
 */
export const BUYM_DEFAULT_BASE = 'https://new-api.24buymseller.com'

export const PROVIDER_KINDS = ['custom', '24buym'] as const
