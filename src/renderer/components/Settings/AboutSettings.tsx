// AboutSettings — 关于页面
import { Typography, Space, Divider, theme } from 'antd'
import { GithubOutlined, RobotOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'

function AboutSettings() {
    const { token } = theme.useToken()
    const [version, setVersion] = useState('...')

    useEffect(() => {
        window.hexAgent.getAppVersion().then(setVersion)
    }, [])

    return (
        <div style={{ padding: '0 16px', textAlign: 'center' }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <RobotOutlined style={{ fontSize: 48, color: token.colorPrimary }} />
                <Typography.Title level={4} style={{ margin: 0 }}>HexAgent</Typography.Title>
                <Typography.Text type="secondary">版本 {version}</Typography.Text>
                <Divider />
                <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                    Windows 桌面 AI 助手
                    <br />
                    支持 Kimi / MiniMax
                    <br />
                    文件读写 | Python 执行
                </Typography.Paragraph>
            </Space>
        </div>
    )
}

export default AboutSettings
