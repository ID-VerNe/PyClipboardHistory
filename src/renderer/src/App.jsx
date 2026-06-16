import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Search, Star, Trash2, Clipboard, Image as ImageIcon, File } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const PAGE_SIZE = 50

// Individual History Item component for better performance
const HistoryItem = memo(({ item, onPaste, onToggleFav, onDelete, formatTimestamp }) => {
  return (
    <div
      onClick={() => onPaste(item)}
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
              src={item.preview_base64 || (item.thumbnail_path ? `local-file:///${item.thumbnail_path.replace(/\\/g, '/')}` : '')} 
              className="max-h-40 w-auto rounded-lg border border-slate-200 dark:border-zinc-700 shadow-sm transition-transform group-hover/img:scale-[1.01]"
              loading="lazy"
              alt="Preview"
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
          className={cn(
            "p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors shadow-sm bg-white dark:bg-zinc-800",
            item.is_favorite ? "text-amber-500" : "text-slate-400"
          )}
        >
          <Star className={cn("h-4 w-4", item.is_favorite && "fill-current")} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
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
  
  const searchInputRef = useRef(null)
  const observerTarget = useRef(null)
  const listRef = useRef(null)
  const optimisticToggleRef = useRef(null)
  const optimisticDeleteRef = useRef(null)
  const processingRef = useRef(new Set())

  const loadHistory = useCallback(async (isNextPage = false) => {
    if (loading) return
    setLoading(true)

    try {
      const offset = isNextPage ? history.length : 0
      const data = await window.api.getHistory(filter, debouncedSearch, PAGE_SIZE, offset)
      
      if (isNextPage) {
        setHistory(prev => [...prev, ...data])
      } else {
        setHistory(data)
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }, [filter, debouncedSearch, history.length, loading])

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadHistory(true)
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [hasMore, loading, loadHistory])

  // Initial load and filter change
  useEffect(() => {
    loadHistory(false)
  }, [filter, debouncedSearch])

  // Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const removeShowListener = window.api.onWindowShown(() => {
      setSearch('')
      setDebouncedSearch('')
      setFilter('All')
      if (listRef.current) listRef.current.scrollTop = 0
      setTimeout(() => searchInputRef.current?.focus(), 100)
    })

    const removeUpdateListener = window.api.onHistoryUpdated(() => loadHistory(false))

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
  }, [loadHistory])

  const handlePaste = useCallback((item) => {
    window.api.pasteItem(item.content, item.data_type).catch(err => {
      console.error('Failed to paste item:', err)
    })
  }, [])

  const toggleFav = useCallback(async (id) => {
    if (processingRef.current.has(id)) return
    processingRef.current.add(id)
    let prevState
    setHistory(prev => {
      const item = prev.find(item => item.id === id)
      prevState = item?.is_favorite
      return prev.map(item => item.id === id ? { ...item, is_favorite: !item.is_favorite } : item)
    })
    try {
      await window.api.toggleFavorite(id)
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      setHistory(prev => prev.map(item => item.id === id ? { ...item, is_favorite: prevState } : item))
    } finally {
      processingRef.current.delete(id)
    }
  }, [])

  const deleteItem = useCallback(async (id) => {
    if (processingRef.current.has(id)) return
    processingRef.current.add(id)
    let deletedItem
    setHistory(prev => {
      const item = prev.find(item => item.id === id)
      deletedItem = item || undefined
      return prev.filter(item => item.id !== id)
    })
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
    } finally {
      processingRef.current.delete(id)
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
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
            <div className="p-4 bg-slate-100 dark:bg-zinc-800 rounded-full">
              <Clipboard className="h-8 w-8 opacity-40" />
            </div>
            <p className="text-sm font-medium opacity-60">No items found</p>
          </div>
        ) : (
          <>
            {history.map(item => (
              <HistoryItem 
                key={item.id}
                item={item}
                onPaste={handlePaste}
                onToggleFav={toggleFav}
                onDelete={deleteItem}
                formatTimestamp={formatTimestamp}
              />
            ))}
            {/* Sentinel element for infinite scroll */}
            <div ref={observerTarget} className="h-10 w-full flex items-center justify-center text-xs text-slate-400">
              {loading ? 'Loading more...' : hasMore ? 'Scroll for more' : 'End of history'}
            </div>
          </>
        )}
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; }
      `}</style>
    </div>
  )
}
