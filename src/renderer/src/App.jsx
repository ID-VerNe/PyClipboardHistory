import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Search, Star, Trash2, Clipboard, Image as ImageIcon, File } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useVirtualizer } from '@tanstack/react-virtual'

function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const PAGE_SIZE = 50
// Hard cap to bound renderer memory; oldest loaded pages are dropped.
const MAX_ITEMS = 500

// Individual History Item component for better performance
const HistoryItem = memo(({ item, onPaste, onToggleFav, onDelete, formatTimestamp }) => {
  return (
    <div
      onClick={() => onPaste(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPaste(item)
        }
      }}
      role="button"
      tabIndex={0}
      className="group relative flex gap-3 p-3 bg-white dark:bg-zinc-800/40 rounded-xl border border-slate-100 dark:border-zinc-800 hover:border-brand-400 dark:hover:border-brand-600 hover:shadow-lg transition-all cursor-pointer overflow-hidden mb-3"
    >
      <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-slate-50 dark:bg-zinc-800 rounded-lg border border-slate-100 dark:border-zinc-700">
        {item.data_type === 'IMAGE' ? (
          <ImageIcon className="h-5 w-5 text-brand-500" />
        ) : item.data_type === 'FILES' ? (
          <File className="h-5 w-5 text-amber-500" />
        ) : (
          <Clipboard className="h-5 w-5 text-slate-400" />
        )}
      </div>

      <div className="flex-1 min-w-0 pr-12">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {item.data_type}
          </span>
          <span className="text-[9px] font-medium text-slate-300 dark:text-zinc-600">
            •
          </span>
          <span className="text-[9px] font-bold text-slate-400">
            {formatTimestamp(item.timestamp)}
          </span>
        </div>

        {item.data_type === 'IMAGE' ? (
          <div className="relative mt-1 group/img">
            <img
              src={item.thumbnail_path ? `local-file:///${item.thumbnail_path.replace(/\\/g, '/')}` : ''}
              className="max-h-40 w-auto rounded-lg border border-slate-200 dark:border-zinc-700 shadow-sm transition-transform group-hover/img:scale-[1.01]"
              loading="lazy"
              alt=""
            />
          </div>
        ) : (
          <p className="text-sm text-slate-700 dark:text-zinc-200 line-clamp-4 break-all leading-relaxed font-medium">
            {item.preview}
          </p>
        )}
      </div>

      <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFav(item.id); }}
          aria-label={item.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            "p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors shadow-sm bg-white dark:bg-zinc-800",
            item.is_favorite ? "text-amber-500" : "text-slate-400"
          )}
        >
          <Star className={cn("h-4 w-4", item.is_favorite && "fill-current")} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          aria-label="Delete item"
          className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shadow-sm bg-white dark:bg-zinc-800"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
})

export default function App() {
  const [history, setHistory] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [error, setError] = useState(null)

  const searchInputRef = useRef(null)
  const listRef = useRef(null)
  const loadHistoryRef = useRef(null)
  const historyLengthRef = useRef(0)

  // Refs that mirror state for use in stable callbacks / effects.
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)
  const filterRef = useRef('All')
  const debouncedSearchRef = useRef('')
  const historyRef = useRef([])

  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { hasMoreRef.current = hasMore }, [hasMore])
  useEffect(() => { filterRef.current = filter }, [filter])
  useEffect(() => { debouncedSearchRef.current = debouncedSearch }, [debouncedSearch])
  useEffect(() => { historyRef.current = history }, [history])

  const loadHistory = useCallback(async (isNextPage = false) => {
    if (loadingRef.current) return
    setLoading(true)
    setError(null)

    try {
      const offset = isNextPage ? historyLengthRef.current : 0
      const data = await window.api.getHistory(filterRef.current, debouncedSearchRef.current, PAGE_SIZE, offset)

      if (isNextPage) {
        setHistory(prev => {
          const combined = [...prev, ...data]
          const capped = combined.length > MAX_ITEMS ? combined.slice(combined.length - MAX_ITEMS) : combined
          historyLengthRef.current = capped.length
          return capped
        })
      } else {
        setHistory(data)
        historyLengthRef.current = data.length
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load history:', err)
      setError('Failed to load clipboard history. Please try again.')
    } finally {
      setLoading(false)
      setInitialLoad(false)
    }
  }, [])

  // Keep ref in sync with latest loadHistory (stable now, but harmless).
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])

  // Infinite scroll observer — stable, reads latest state via refs.
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
          loadHistoryRef.current(true)
        }
      },
      { root: listRef.current, threshold: 0.1 }
    )

    const target = listRef.current?.querySelector('[data-sentinel]')
    if (target) observer.observe(target)

    return () => observer.disconnect()
  }, [])

  // Initial load and filter change
  useEffect(() => {
    loadHistory(false)
  }, [filter, debouncedSearch, loadHistory])

  // Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // IPC subscriptions — stable (deps []), reads latest state via refs.
  useEffect(() => {
    const removeShowListener = window.api.onWindowShown(() => {
      setSearch('')
      setDebouncedSearch('')
      setFilter('All')
      setInitialLoad(true)
      if (listRef.current) listRef.current.scrollTop = 0
      // Force a fresh first-page load on every show. Setting filter/search to the
      // same values they may already hold does NOT retrigger the load effect
      // (React bails out on unchanged state), so items copied while the window
      // was hidden would never appear until the user toggled a filter. Sync the
      // refs here so loadHistory reads the intended 'All'/'' rather than the
      // stale ref value (refs update asynchronously via their own effect).
      filterRef.current = 'All'
      debouncedSearchRef.current = ''
      loadHistoryRef.current(false)
      setTimeout(() => searchInputRef.current?.focus(), 100)
    })

    const removeUpdateListener = window.api.onHistoryUpdated((entry) => {
      if (!entry) {
        // Fallback: unknown update — reload first page only if not searching.
        if (!debouncedSearchRef.current && filterRef.current === 'All') {
          loadHistoryRef.current(false)
        }
        return
      }
      // Incremental: prepend new / move-to-top entry. Skip if a search/filter is active
      // (the entry may not match the current view).
      if (debouncedSearchRef.current || filterRef.current !== 'All') {
        if (filterRef.current !== 'All' && entry.data_type !== filterRef.current) return
      }
      setHistory(prev => {
        const without = prev.filter(i => i.id !== entry.id)
        return [entry, ...without].slice(0, MAX_ITEMS)
      })
    })

    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      removeShowListener()
      removeUpdateListener()
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handlePaste = useCallback((item) => {
    window.api.pasteItem(item.content, item.data_type).catch(err => {
      console.error('Failed to paste item:', err)
    })
  }, [])

  const toggleFav = useCallback(async (id) => {
    const prevState = historyRef.current.find(item => item.id === id)?.is_favorite
    setHistory(prev => prev.map(item => item.id === id ? { ...item, is_favorite: !item.is_favorite } : item))
    try {
      await window.api.toggleFavorite(id)
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      setHistory(prev => prev.map(item => item.id === id ? { ...item, is_favorite: prevState } : item))
    }
  }, [])

  const deleteItem = useCallback(async (id) => {
    const deletedItem = historyRef.current.find(item => item.id === id)
    setHistory(prev => prev.filter(item => item.id !== id))
    try {
      await window.api.deleteEntry(id)
    } catch (err) {
      console.error('Failed to delete entry:', err)
      if (deletedItem) {
        setHistory(prev => {
          if (prev.some(item => item.id === id)) return prev
          return [...prev, deletedItem].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        })
      }
    }
  }, [])

  const formatTimestamp = useCallback((ts) => {
    const date = new Date(ts)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }, [])

  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 120,
    overscan: 8
  })

  const items = virtualizer.getVirtualItems()

  // Determine what message to show in the empty state
  const getEmptyMessage = () => {
    if (debouncedSearch) return 'No results found'
    if (filter !== 'All') return `No ${filter.toLowerCase()} items found`
    return 'No items found'
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="p-4 space-y-3 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md border-b border-slate-200 dark:border-zinc-800">
        <div className="relative group">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 group-focus-within:text-brand-500 transition-colors" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search clipboard (Ctrl+F)..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 transition-all outline-none shadow-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          {['All', 'TEXT', 'IMAGE', 'Favorites'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all",
                filter === f
                  ? "bg-brand-600 text-white shadow-lg shadow-brand-500/30"
                  : "bg-slate-200 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-300 dark:hover:bg-zinc-700"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List Container */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {/* Initial loading state */}
        {initialLoad && loading && history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
            <div className="p-4 bg-slate-100 dark:bg-zinc-800 rounded-full">
              <Clipboard className="h-8 w-8 opacity-40" />
            </div>
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm font-medium opacity-60">Loading...</p>
            </div>
          </div>
        ) : /* Error state */
        error && history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4 p-8">
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-full">
              <Clipboard className="h-8 w-8 text-red-400" />
            </div>
            <p className="text-sm font-medium text-red-400 text-center">{error}</p>
            <button
              onClick={() => loadHistory(false)}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-brand-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : /* Empty state */
        history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
            <div className="p-4 bg-slate-100 dark:bg-zinc-800 rounded-full">
              <Clipboard className="h-8 w-8 opacity-40" />
            </div>
            <p className="text-sm font-medium opacity-60">{getEmptyMessage()}</p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {items.map(virtualItem => (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                <HistoryItem
                  item={history[virtualItem.index]}
                  onPaste={handlePaste}
                  onToggleFav={toggleFav}
                  onDelete={deleteItem}
                  formatTimestamp={formatTimestamp}
                />
              </div>
            ))}
            {/* Sentinel element for infinite scroll */}
            <div data-sentinel className="h-10 w-full flex items-center justify-center text-xs text-slate-400">
              {loading ? 'Loading more...' : hasMore ? 'Scroll for more' : 'End of history'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
