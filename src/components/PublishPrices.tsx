import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { publishPricesAction } from '@/lib/actions/catalog'
import { num } from '@/lib/format'

/**
 * แถบ "ราคายังไม่ขึ้นเว็บ" พร้อมปุ่มเผยแพร่
 *
 * ราคาที่แก้ในหลังร้านจะยังไม่มีผลกับลูกค้าจนกว่าจะกดปุ่มนี้
 * แถบนี้จึงต้องเด่นพอที่จะไม่ถูกมองข้าม ไม่งั้นจะแก้ราคาแล้วงงว่าทำไมหน้าเว็บไม่เปลี่ยน
 */
export function PublishPrices({
  pending,
  gameId,
}: {
  pending: number
  /** ระบุ = เผยแพร่เฉพาะเกมนี้, ไม่ระบุ = ทั้งร้าน */
  gameId?: number
}) {
  if (pending === 0) {
    return (
      <div className="mb-4 rounded-xl border border-good/30 bg-good/5 px-4 py-2.5 text-xs text-good">
        ✓ ราคาบนหน้าเว็บตรงกับที่ตั้งไว้แล้ว
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-warn">
            ⏳ มีราคาที่แก้ไว้แล้วแต่ยังไม่ขึ้นหน้าเว็บ {num(pending)} แพ็กเกจ
          </p>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            ลูกค้ายังเห็นและจ่ายราคาเดิมอยู่ · แก้ให้ครบก่อนแล้วค่อยกดปุ่มนี้ครั้งเดียว
            ราคาจะขึ้นพร้อมกันทั้งหมด
            {gameId ? ' (เฉพาะเกมนี้)' : ' (ทุกเกมในร้าน)'}
          </p>
        </div>
        <ActionForm action={publishPricesAction}>
          {gameId ? <input type="hidden" name="game_id" value={gameId} /> : null}
          <SubmitButton className="btn-primary" pendingLabel="กำลังอัปเดต...">
            อัปเดตราคาขึ้นหน้าเว็บ
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  )
}
