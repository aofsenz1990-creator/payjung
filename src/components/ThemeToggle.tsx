'use client'

import { useState } from 'react'

/**
 * ปุ่มสลับธีมสว่าง/มืดของหน้าเว็บลูกค้า
 *
 * เก็บค่าไว้ใน cookie ไม่ใช่ localStorage เพราะเซิร์ฟเวอร์ต้องอ่านค่าได้ตั้งแต่ตอนสร้างหน้า
 * ถ้าเก็บใน localStorage หน้าจะถูกส่งมาเป็นธีมมืดก่อนแล้วค่อยกระพริบเปลี่ยนเป็นสว่างทีหลัง
 * ซึ่งเห็นชัดมากและดูเหมือนเว็บพัง
 */
export function ThemeToggle({ initial }: { initial: 'dark' | 'light' }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(initial)

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)

    // เปลี่ยนที่หน้าจอทันทีโดยไม่ต้องรอโหลดหน้าใหม่
    document.querySelector('[data-shop-root]')?.setAttribute('data-theme', next)
    // จำไว้ใช้รอบหน้า (1 ปี)
    document.cookie = `shop-theme=${next}; path=/; max-age=31536000; samesite=lax`
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}
      title={theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}
      className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-body transition hover:border-ink-600 hover:bg-ink-800"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
