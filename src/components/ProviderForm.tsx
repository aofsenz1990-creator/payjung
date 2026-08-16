'use client'

import { useState } from 'react'
import { ActionForm, SubmitButton, type ActionState } from '@/components/ActionForm'
import { PROVIDER_KIND_META, providerMeta } from '@/lib/providers/constants'

export type ProviderDraft = {
  id: number
  name: string
  kind: string
  base_url: string | null
  auth_type: string
  has_key: boolean
  username: string | null
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
  const meta = providerMeta(kind)
  // ที่อยู่ API ตายตัว = ล็อกช่องไว้เลย จะได้ไม่ต้องสงสัยว่าต้องกรอกอะไร
  const fixedBase = meta.fixedBaseUrl
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
          {PROVIDER_KIND_META.map((m) => (
            <option key={m.kind} value={m.kind}>
              {m.label}
            </option>
          ))}
        </select>
        {!meta.autoSupported ? (
          <p className="mt-1 text-xs leading-relaxed text-warn">
            เจ้านี้ยังส่งออเดอร์อัตโนมัติไม่ได้ — เก็บข้อมูลบัญชีไว้ได้ก่อน
            ออเดอร์ของแพ็กเกจที่ผูกกับเจ้านี้จะขึ้นว่า &quot;ต้องเติมเอง&quot; ที่หน้าลงยอดขาย
          </p>
        ) : null}
      </div>

      {fixedBase ? (
        <div>
          <span className="label">ที่อยู่ API</span>
          <input type="hidden" name="base_url" value={fixedBase} />
          <p className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-mute">
            {fixedBase}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            ตั้งให้อัตโนมัติแล้ว ไม่ต้องกรอก — ส่วนท้ายอย่าง{' '}
            <code className="text-slate-300">/getAccount/</code>,{' '}
            <code className="text-slate-300">/addOrder/</code> ระบบต่อให้เองตอนเรียกใช้
          </p>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="base_url">
            ที่อยู่ API
          </label>
          <input
            id="base_url"
            name="base_url"
            className="input"
            defaultValue={editing?.base_url ?? ''}
            placeholder="https://api.example.com/v1"
          />
        </div>
      )}

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

      {/* ผู้ให้บริการที่ใช้ ID + รหัสผ่าน ต้องกรอก ID ด้วย ส่วนเจ้าที่ใช้คีย์เดี่ยวไม่ต้อง */}
      {meta.needsUsername ? (
        <div>
          <label className="label" htmlFor="username">
            ID ผู้ใช้ / เลขบัญชีร้าน
          </label>
          <input
            id="username"
            name="username"
            className="input"
            autoComplete="off"
            defaultValue={editing?.username ?? ''}
            placeholder="ID ที่ผู้ให้บริการออกให้ร้านเรา"
          />
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="api_key">
          {isBuym ? 'USER_KEY' : meta.needsUsername ? 'รหัสผ่าน' : 'คีย์ / โทเคน'}
        </label>
        <input
          id="api_key"
          name="api_key"
          type="password"
          className="input"
          autoComplete="new-password"
          placeholder={
            editing?.has_key
              ? `มี${meta.needsUsername ? 'รหัสผ่าน' : 'คีย์'}อยู่แล้ว — เว้นว่างถ้าไม่เปลี่ยน`
              : `วาง${meta.needsUsername ? 'รหัสผ่าน' : 'คีย์'}ที่นี่`
          }
        />
        <p className="mt-1 text-xs leading-relaxed text-mute">
          {isBuym ? (
            <>
              <b className="text-warn">ช่องนี้ช่องเดียวที่ต้องกรอก</b> — วางคีย์ที่ 24BUYM
              ให้มา (ที่เอกสารเขียนแทนว่า YOUR_USER_KEY) ไม่ต้องเอาไปแปะใน URL
            </>
          ) : (
            'เก็บในฐานข้อมูลและใช้เฉพาะฝั่งเซิร์ฟเวอร์'
          )}{' '}
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
