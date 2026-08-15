'use client'

/**
 * ด่านสุดท้ายเวลาพังตั้งแต่ layout ชั้นนอกสุด
 * ต้องมี html/body ของตัวเอง เพราะ layout หลักถูกแทนที่ทั้งหมด
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="th">
      <body
        style={{
          background: '#0c0916',
          color: '#e8ecfa',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '32rem', width: '100%' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
            ระบบขัดข้อง
          </h1>
          <p style={{ color: '#9b93c0', fontSize: '0.875rem', lineHeight: 1.7 }}>
            ลองกดโหลดใหม่ ถ้ายังไม่หายให้ส่งข้อความด้านล่างนี้ให้คนดูแลระบบ
          </p>
          <pre
            style={{
              background: '#191430',
              border: '1px solid #2c2450',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              fontSize: '0.75rem',
              color: '#ff6b7a',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message || 'ไม่มีรายละเอียดเพิ่มเติม'}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#d93f82',
              color: '#fff',
              border: 0,
              borderRadius: '0.5rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            ลองใหม่
          </button>
        </div>
      </body>
    </html>
  )
}
