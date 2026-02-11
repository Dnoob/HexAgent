// InlineArtifact — 内嵌图片渲染（工具消息中的 artifact 展示）
import { useState, useCallback } from 'react'
import { Button, Tooltip } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'

interface Artifact {
    type: 'image'
    name: string
    base64: string
}

interface Props {
    artifacts: Artifact[]
}

function downloadBase64(dataUrl: string, filename: string) {
    const [header, data] = dataUrl.split(',')
    if (!data) return
    const mimeMatch = header.match(/data:(.*?);/)
    const mime = mimeMatch?.[1] || 'application/octet-stream'
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

export default function InlineArtifact({ artifacts }: Props) {
    const [previewSrc, setPreviewSrc] = useState<string | null>(null)

    const handleClose = useCallback(() => setPreviewSrc(null), [])

    const imageArtifacts = artifacts.filter((a) => a.type === 'image')
    if (imageArtifacts.length === 0) return null

    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {imageArtifacts.map((artifact, index) => (
                    <ArtifactCard
                        key={index}
                        artifact={artifact}
                        onPreview={() => setPreviewSrc(artifact.base64)}
                    />
                ))}
            </div>

            {/* Full-screen preview overlay */}
            {previewSrc && (
                <div
                    onClick={handleClose}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 10000,
                        background: 'rgba(0, 0, 0, 0.75)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out',
                    }}
                >
                    <img
                        src={previewSrc}
                        alt="preview"
                        style={{
                            maxWidth: '90vw', maxHeight: '90vh',
                            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </>
    )
}

function ArtifactCard({ artifact, onPreview }: { artifact: Artifact; onPreview: () => void }) {
    const [hovered, setHovered] = useState(false)

    return (
        <div
            style={{
                background: 'var(--chatgpt-sider-hover, #f3f4f6)',
                borderRadius: 12, padding: 8,
                display: 'inline-block', maxWidth: 400,
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div style={{ position: 'relative' }}>
                <img
                    src={artifact.base64}
                    alt={artifact.name}
                    onClick={onPreview}
                    style={{
                        maxWidth: '100%', display: 'block',
                        borderRadius: 8, cursor: 'zoom-in',
                        border: '1px solid var(--border-subtle, #e5e7eb)',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    }}
                />
                {hovered && (
                    <div style={{ position: 'absolute', top: 6, right: 6 }}>
                        <Tooltip title="下载">
                            <Button
                                type="primary"
                                size="small"
                                icon={<DownloadOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    downloadBase64(artifact.base64, artifact.name)
                                }}
                                style={{
                                    opacity: 0.85,
                                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                                }}
                            />
                        </Tooltip>
                    </div>
                )}
            </div>
            <div style={{
                fontSize: 11, color: 'var(--text-tertiary)',
                marginTop: 4, paddingLeft: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
                {artifact.name}
            </div>
        </div>
    )
}
