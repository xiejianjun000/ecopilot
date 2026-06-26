/**
 * 第一步：上传排污许可证
 */

import { useCallback, useState, useRef } from 'react'
import { setStep, setPermitFile } from '../store/onboarding'

export function PermitUpload() {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    setPermitFile(file)
    setStep('platform-login')
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="text-center space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">📋 让我认识一下您的企业</h2>
        <p className="text-muted-foreground">
          请上传排污许可证（PDF或图片），AI将自动识别企业信息
        </p>
      </div>

      {/* 上传区域 */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-12 transition-all cursor-pointer ${
          dragOver
            ? 'border-emerald-400 bg-emerald-50'
            : 'border-muted-foreground/20 hover:border-emerald-300 hover:bg-muted/30'
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />

        <div className="space-y-3">
          <span className="text-4xl">📄</span>
          <p className="text-sm font-medium">
            拖拽文件到此处，或<span className="text-emerald-600">点击选择文件</span>
          </p>
          <p className="text-xs text-muted-foreground">
            支持 PDF · PNG · JPG · 截图
          </p>
        </div>
      </div>

      {/* 为什么需要许可证 */}
      <div className="text-left bg-muted/50 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">🔒 为什么需要排污许可证？</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>✅ 自动识别企业的行业类别和排放标准</li>
          <li>✅ 精准匹配适用的环保法规和地方政策</li>
          <li>✅ AI建议针对您的企业，而非泛泛而谈</li>
        </ul>
      </div>

      {/* 跳过按钮 */}
      <button
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setStep('platform-login')}
      >
        暂不上传，手动填写企业信息
      </button>
    </div>
  )
}
