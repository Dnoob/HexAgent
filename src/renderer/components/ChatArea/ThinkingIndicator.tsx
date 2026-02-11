// ThinkingIndicator — AI 思考中动画
import { RobotOutlined } from '@ant-design/icons'
import { theme } from 'antd'

function ThinkingIndicator() {
    const { token } = theme.useToken()

    return (
        <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 0',
        }}>
            <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: token.colorFillSecondary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: token.colorTextSecondary,
                fontSize: 16,
                flexShrink: 0,
            }}>
                <RobotOutlined />
            </div>
            <div style={{
                background: token.colorBgContainer,
                padding: '12px 16px',
                borderRadius: '12px 12px 12px 2px',
                boxShadow: `0 1px 2px ${token.colorFillQuaternary}`,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
            }}>
                <style>{`
                    @keyframes thinking-dot {
                        0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                        40% { opacity: 1; transform: scale(1); }
                    }
                `}</style>
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: token.colorTextQuaternary,
                            animation: `thinking-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
                        }}
                    />
                ))}
            </div>
        </div>
    )
}

export default ThinkingIndicator
