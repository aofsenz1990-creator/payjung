'use client'

import { useState } from 'react'
import { ActionForm, SubmitButton, type ActionState } from '@/components/ActionForm'
import { BUYM_DEFAULT_BASE } from '@/lib/providers/constants'

export type ProviderDraft = {
  id: number
  name: string
  kind: string
  base_url: string | null
  auth_type: string
  has_key: boolean
  note: string | null
  priority: number
  is_active: boolean
}

const AUTH_LABELS: Record<string, string> = {
  bearer: 'Bearer Token (ส่งใน Authorization)',
  apikey: 'API Key (ส่งใน header)',
  basic: 'Basic Auth (user:pass)',
  none: 'ไม่ต้องยืนยันตัวตน',
}

export function ProviderForm({
  action,
  editing,
}: {
  action: (formData: FormData) => Promise<ActionState>
  editing: ProviderDraft | null
}) {
  const [kind, setKind] = useState(editing?.kind ?? '24buym')
  const isBuym = kind === '24buym'

  return (
    <ActionForm action={action} className="space-y-4" resetOnSuccess={!editing}>
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

      <div>
        <label className="label" htmlFor="name">
          ชื่อผู้ให้บริการ
        </label>
        <input
          id="name"
          name="name"
          className="input"
          defaultValue={editing?.name ?? ''}
          placeholder={isBuym ? '24BUYM' : 'เช่น TopupHub, GameStore API'}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="kind">
          ชนิดของ API
        </label>
        <select
          id="kind"
          name="kind"
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="24buym">24BUYM (รองรับเต็มรูปแบบ)</option>
          <option value="custom">อื่น ๆ (เก็บข้อมูลไว้ก่อน)</option>
        </select>
      </div>

      <div>
        <label className="label" htmlFor="base_url">
          ที่อยู่ API
        </label>
        <input
          id="base_url"
          name="base_url"
          className="input"
          defaultValue={editing?.base_url ?? BUYM_DEFAULT_BASE}
          placeholder={BUYM_DEFAULT_BASE}
          key={kind}
        />
        {isBuym ? (
          <p className="mt-1 text-xs text-mute">ของ 24BUYM ใช้ค่านี้ได้เลย ไม่ต้องแก้</p>
        ) : null}
      </div>

      {/* 24BUYM ส่งคีย์ไปกับ path ของ URL จึงไม่มีเรื่องวิธียืนยันตัวตนให้เลือก */}
      {isBuym ? (
        <input type="hidden" name="auth_type" value="none" />
      ) : (
        <div>
          <label className="label" htmlFor="auth_type">
            วิธียืนยันตัวตน
          </label>
          <select
            id="auth_type"
            name="auth_type"
            className="input"
            defaultValue={editing?.auth_type ?? 'bearer'}
          >
            {Object.entries(AUTH_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label" htmlFor="api_key">
          {isBuym ? 'USER_KEY' : 'คีย์ / โทเคน'}
        </label>
        <input
          id="api_key"
          name="api_key"
          type="password"
          className="input"
          autoComplete="new-password"
          placeholder={editing?.has_key ? 'มีคีย์อยู่แล้ว — เว้นว่างถ้าไม่เปลี่ยน' : 'วางคีย์ที่นี่'}
        />
        <p className="mt-1 text-xs leading-relaxed text-mute">
          {isBuym
            ? 'คีย์ของ 24BUYM จะถูกแนบไปกับ URL ตอนเรียก API ตามที่เอกสารกำหนด'
            : 'เก็บในฐานข้อมูลและใช้เฉพาะฝั่งเซิร์ฟเวอร์'}{' '}
          ไม่ถูกส่งออกไปที่เบราว์เซอร์
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="priority">
            ลำดับความสำคัญ
          </label>
          <input
            id="priority"
            name="priority"
            type="number"
            className="input"
            defaultValue={editing?.priority ?? 100}
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editing ? editing.is_active : true}
              className="size-4 rounded border-ink-600 bg-ink-850"
            />
            เปิดใช้งาน
          </label>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="note">
          หมายเหตุ
        </label>
        <input
          id="note"
          name="note"
          className="input"
          defaultValue={editing?.note ?? ''}
          placeholder="เช่น ใช้กับเกมค่าย Garena"
        />
      </div>

      <SubmitButton className="btn-primary w-full">
        {editing ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ให้บริการ'}
      </SubmitButton>
    </ActionForm>
  )
}
