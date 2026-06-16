import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
          color: '#334155'
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.5rem' }}>
            An unexpected error occurred.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer'
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                background: '#e2e8f0',
                color: '#475569',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)