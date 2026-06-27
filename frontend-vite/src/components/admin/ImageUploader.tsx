import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../../services/api'
import './ImageUploader.css'

interface Props {
  value?: string
  onChange: (url: string) => void
}

export function ImageUploader({ value, onChange }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    setError('')
    setUploading(true)
    try {
      // 上传走 cookie 鉴权，无需传递 token
      const data = await api.admin.media.upload(file)
      onChange(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`image-uploader ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) handleFile(f)
      }}
      onClick={() => fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
      {value ? (
        <div className="image-uploader__preview">
          <img src={value} alt="预览" />
          <div className="image-uploader__url">{value}</div>
        </div>
      ) : (
        <>
          <Upload size={28} />
          <div className="image-uploader__hint">
            {uploading ? '上传中...' : '点击或拖拽图片到此上传（≤5MB，支持 PNG/JPG/WebP/GIF）'}
          </div>
        </>
      )}
      {error && <div className="image-uploader__error">{error}</div>}
    </div>
  )
}
