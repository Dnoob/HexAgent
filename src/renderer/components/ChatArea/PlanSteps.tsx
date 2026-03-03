// PlanSteps — 计划步骤展示组件
import { theme } from 'antd'
import {
    ClockCircleOutlined,
    LoadingOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
} from '@ant-design/icons'
import type { Plan } from '@shared/types'

const statusConfig = {
    pending: { icon: ClockCircleOutlined, color: 'colorTextQuaternary' as const },
    in_progress: { icon: LoadingOutlined, color: 'colorPrimary' as const },
    completed: { icon: CheckCircleOutlined, color: 'colorSuccess' as const },
    failed: { icon: CloseCircleOutlined, color: 'colorError' as const },
}

function PlanSteps({ plan }: { plan: Plan }) {
    const { token } = theme.useToken()

    return (
        <div style={{
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 6,
            fontSize: 12,
        }}>
            <div style={{ fontWeight: 500, marginBottom: 4, color: token.colorTextSecondary }}>
                执行计划
            </div>
            {plan.steps.map((step, i) => {
                const cfg = statusConfig[step.status]
                const Icon = cfg.icon
                return (
                    <div key={i} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 0',
                        color: step.status === 'pending' ? token.colorTextQuaternary : token.colorText,
                    }}>
                        <Icon style={{ fontSize: 13, color: token[cfg.color] }} spin={step.status === 'in_progress'} />
                        <span>{step.title}</span>
                    </div>
                )
            })}
        </div>
    )
}

export default PlanSteps
