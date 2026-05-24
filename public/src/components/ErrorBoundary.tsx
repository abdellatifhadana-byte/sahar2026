import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#080818] flex items-center justify-center p-6" dir="rtl">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-6">⚠️</div>
            <h1 className="text-white text-2xl font-black mb-3">حدث خطأ غير متوقع</h1>
            <p className="text-white/40 text-sm mb-6 leading-relaxed">
              {this.state.error?.message || 'خطأ غير معروف'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-500 transition-all"
              >
                🔄 إعادة التشغيل
              </button>
              <button
                onClick={() => { localStorage.clear(); window.location.reload(); }}
                className="px-6 py-3 bg-white/5 text-white/60 rounded-xl font-bold text-sm hover:bg-white/10 transition-all border border-white/8"
              >
                🗑️ مسح البيانات
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
