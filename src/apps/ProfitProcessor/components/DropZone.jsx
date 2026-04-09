import { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'

const ACCEPTED = ['.xlsx', '.xls']

function isValidFile(file) {
  return /\.(xlsx|xls)$/i.test(file.name)
}

export default function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file && isValidFile(file)) onFile(file)
    },
    [onFile]
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    // Only clear if leaving the drop zone entirely (not a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragging(false)
    }
  }, [])

  const handleChange = useCallback(
    (e) => {
      const file = e.target.files?.[0]
      if (file) onFile(file)
      // Reset so same file can be re-uploaded
      e.target.value = ''
    },
    [onFile]
  )

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      aria-label="Drop Excel file here or click to browse"
      style={{
        border: `2px dashed ${dragging ? '#f3ca0f' : '#333'}`,
        background: dragging ? 'rgba(243,202,15,0.04)' : '#0a0a0a',
        boxShadow: dragging ? '0 0 48px rgba(243,202,15,0.08)' : 'none',
      }}
      className="
        w-full max-w-lg cursor-pointer select-none outline-none
        rounded-lg transition-all duration-150
        flex flex-col items-center justify-center
        px-10 py-20 gap-6
        hover:border-[#555] hover:bg-[#141414]
        focus-visible:ring-2 focus-visible:ring-[#f3ca0f]/40
      "
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleChange}
      />

      {/* Upload icon */}
      <Upload
        size={40}
        strokeWidth={1.25}
        style={{ color: dragging ? 'var(--accent)' : 'var(--text-disabled)', transition: 'color 150ms' }}
      />

      {/* Labels */}
      <div className="text-center flex flex-col gap-1.5">
        <p
          className="text-base font-medium transition-colors"
          style={{ color: dragging ? '#f3ca0f' : '#CCC' }}
        >
          {dragging ? 'Release to load report' : 'Drop Cin7 Profit Summary Report'}
        </p>
        <p className="text-sm" style={{ color: '#666' }}>
          or{' '}
          <span
            className="underline underline-offset-2 transition-colors"
            style={{ color: '#f3ca0f' }}
          >
            click to browse
          </span>
        </p>
      </div>

      {/* Accepted file types */}
      <div className="flex gap-2">
        {ACCEPTED.map((ext) => (
          <span
            key={ext}
            className="px-2 py-0.5 rounded text-xs font-mono border"
            style={{ color: '#666', borderColor: '#222222', background: '#0a0a0a' }}
          >
            {ext}
          </span>
        ))}
      </div>

      <p className="text-xs text-center" style={{ color: '#444' }}>
        Cin7 Core → Reports → Profit Summary Report → Export Excel
      </p>
    </div>
  )
}
