// SettingsModal — 设置弹窗
import { Modal, Tabs } from 'antd'
import { SettingOutlined, RobotOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useUIStore } from '../../store'
import ProviderSettings from './ProviderSettings'
import GeneralSettings from './GeneralSettings'
import AboutSettings from './AboutSettings'

function SettingsModal() {
    const open = useUIStore((s) => s.settingsModalOpen)
    const closeSettings = useUIStore((s) => s.closeSettings)

    return (
        <Modal
            title="设置"
            open={open}
            onCancel={closeSettings}
            footer={null}
            width={560}
            styles={{ body: { padding: '16px 0' } }}
        >
            <Tabs
                tabPosition="left"
                items={[
                    {
                        key: 'provider',
                        label: <span><RobotOutlined /> 模型</span>,
                        children: <ProviderSettings />,
                    },
                    {
                        key: 'general',
                        label: <span><SettingOutlined /> 通用</span>,
                        children: <GeneralSettings />,
                    },
                    {
                        key: 'about',
                        label: <span><InfoCircleOutlined /> 关于</span>,
                        children: <AboutSettings />,
                    },
                ]}
            />
        </Modal>
    )
}

export default SettingsModal
