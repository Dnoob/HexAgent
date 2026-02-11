// ErrorBoundary — React 错误边界
import { Component, type ReactNode } from 'react'
import { Button, Result } from 'antd'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info)
    }

    render() {
        if (this.state.hasError) {
            return (
                <Result
                    status="error"
                    title="出了点问题"
                    subTitle={this.state.error?.message || '未知错误'}
                    extra={
                        <Button type="primary" onClick={() => this.setState({ hasError: false, error: null })}>
                            重试
                        </Button>
                    }
                />
            )
        }
        return this.props.children
    }
}

export default ErrorBoundary
