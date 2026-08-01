import { Component, type ErrorInfo, type ReactNode } from 'react';

import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ChatWorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {}

  render() {
    if (this.state.hasError) {
      return (
        <section className="flex min-w-0 flex-1 items-center justify-center bg-white" role="alert">
          <div className="max-w-sm text-center">
            <h2 className="text-base font-semibold text-slate-900">聊天页面暂时无法显示</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">请重新加载聊天区；若问题持续出现，请检查服务是否正在重启。</p>
            <Button className="mt-5" onClick={() => this.setState({ hasError: false })} type="button" variant="outline">
              <RefreshCw aria-hidden="true" className="size-4" />
              重新加载聊天区
            </Button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
