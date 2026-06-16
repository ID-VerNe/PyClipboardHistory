import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 p-8">
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-full mb-4">
            <svg className="h-8 w-8 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <p className="text-sm font-bold uppercase tracking-wider mb-2">Something went wrong</p>
          <p className="text-xs text-center mb-6 opacity-60">
            An unexpected error occurred. Please restart the app.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-brand-700 transition-colors"
          >
            Reload
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
