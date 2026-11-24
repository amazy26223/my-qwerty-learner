import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { romajiToHiragana } from '@/utils/kana'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const pronunciationApi = 'https://dict.youdao.com/dictvoice?audio='

// Youdao returns HTTP 500 for parentheses, quotation marks, and an encoded "&".
// Apostrophes inside a word, as in "don't", still pronounce.
function spokenWord(word: string): string {
  const withoutAmpersand = word.replace(/&/g, ' and ')
  const withoutMarks = withoutAmpersand.replace(/[()（）「」"“”]/g, '')
  const withoutLooseQuotes = withoutMarks.replace(/['‘’]+/g, (marks, offset, text) => {
    const before = text[offset - 1] ?? ''
    const after = text[offset + marks.length] ?? ''
    if (/[A-Za-z]/.test(before) && /[A-Za-z]/.test(after)) return marks
    return ''
  })
  return withoutLooseQuotes.replace(/\\s+/g, ' ').trim()
}

export function generateWordSoundSrc(word: string, pronunciation: Exclude<PronunciationType, false>): string {
  // "marui/marui" becomes まるい/まるい, which Youdao rejects. Read the first form.
  const source = pronunciation === 'romaji' || pronunciation === 'ja' ? word.split('/')[0] : word
  const cleaned = spokenWord(source)
  if (!cleaned) return ''
  const spoken = pronunciation === 'romaji' ? romajiToHiragana(cleaned) : cleaned

  switch (pronunciation) {
    case 'uk':
      return `${pronunciationApi}${spoken}&type=1`
    case 'us':
      return `${pronunciationApi}${spoken}&type=2`
    case 'romaji':
      return `${pronunciationApi}${spoken}&le=jap`
    case 'zh':
      return `${pronunciationApi}${spoken}&le=zh`
    case 'ja':
      return `${pronunciationApi}${spoken}&le=jap`
    case 'de':
      return `${pronunciationApi}${spoken}&le=de`
    case 'hapin':
    case 'kk':
      return `${pronunciationApi}${spoken}&le=ru` // 有道不支持哈萨克语, 暂时用俄语发音兜底
    case 'id':
      return `${pronunciationApi}${spoken}&le=id`
    default:
      return ''
  }
}

/**
 * 单词发音播放器 (原生 Audio + LRU 缓存)
 *
 * 这里刻意不用 Howler: 每个单词都新建 Howl 实例会不断占用 Howler 的 HTML5 音频池,
 * 池耗尽后它返回"可能仍被锁定的音频对象", 表现为偶发没有声音、手动点一下才响。
 * 同时旧的预取实现设置了 crossOrigin='anonymous', 而有道接口不返回 CORS 头,
 * 预取请求会被浏览器直接拦截, 等于没有预热, 自动播放时音频还在下载中, play() 被打断。
 *
 * 现在: 同一个 URL 只创建一个 Audio 并复用 (预取与播放共用缓存), 播放失败自动重试一次。
 */
const PRONUNCIATION_CACHE_LIMIT = 8

type CachedAudio = {
  audio: HTMLAudioElement
  lastUsedAt: number
}

const audioCache = new Map<string, CachedAudio>()

/** 偶发无声时的排查用统计: 控制台执行 __qwertyAudio 查看 */
export const pronunciationAudioStats = {
  plays: 0,
  failures: 0,
  cached: 0,
  lastError: '',
}
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__qwertyAudio = pronunciationAudioStats
}

function evictLeastRecentlyUsed() {
  pronunciationAudioStats.cached = audioCache.size
  if (audioCache.size <= PRONUNCIATION_CACHE_LIMIT) return

  let oldestKey = ''
  let oldestUsedAt = Number.POSITIVE_INFINITY
  audioCache.forEach((entry, key) => {
    if (entry.lastUsedAt < oldestUsedAt) {
      oldestUsedAt = entry.lastUsedAt
      oldestKey = key
    }
  })
  if (!oldestKey) return

  const entry = audioCache.get(oldestKey)
  audioCache.delete(oldestKey)
  if (entry) {
    entry.audio.pause()
    entry.audio.removeAttribute('src')
    entry.audio.load()
  }
  pronunciationAudioStats.cached = audioCache.size
}

function getCachedAudio(src: string): HTMLAudioElement {
  const cached = audioCache.get(src)
  if (cached) {
    cached.lastUsedAt = Date.now()
    return cached.audio
  }

  const audio = new Audio()
  // 不要设置 crossOrigin: 有道接口没有 CORS 头, 设置后浏览器会拦截该请求, 反而没有声音
  audio.preload = 'auto'
  audio.src = src
  audio.load()

  audioCache.set(src, { audio, lastUsedAt: Date.now() })
  evictLeastRecentlyUsed()
  return audio
}

/** 预取 (下一词) —— 与播放共用同一份缓存, 保证真正预热 */
export function prefetchPronunciation(src: string | undefined) {
  if (!src) return
  getCachedAudio(src)
}

type PlayOptions = {
  volume?: number
  rate?: number
  loop?: boolean
}

async function playWithRetry(audio: HTMLAudioElement, options: PlayOptions, retriesLeft = 1): Promise<void> {
  const volume = Math.min(1, Math.max(0, options.volume ?? 1))
  const rate = options.rate && options.rate > 0 ? options.rate : 1

  audio.volume = volume
  // 部分浏览器只允许 0.25~4 之间的播放速率
  audio.playbackRate = Math.min(4, Math.max(0.25, rate))
  audio.loop = options.loop ?? false

  try {
    audio.pause()
    audio.currentTime = 0
    await audio.play()
    pronunciationAudioStats.plays += 1
  } catch (error) {
    // AbortError: 播放被新的 load()/pause() 打断(音频还没下载完时最常见)
    // NotAllowedError: 浏览器暂未放行自动播放(还没有用户交互)
    // 这两种情况稍等重试一次通常就能播放, 这正是"偶发无声、手动点一下就好"的成因
    if (retriesLeft > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 180))
      return playWithRetry(audio, options, retriesLeft - 1)
    }
    pronunciationAudioStats.failures += 1
    pronunciationAudioStats.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.warn('[pronunciation] 单词发音播放失败:', pronunciationAudioStats.lastError)
  }
}

export default function usePronunciationSound(word: string, isLoop?: boolean) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const loop = useMemo(
    () => (typeof isLoop === 'boolean' ? isLoop : pronunciationConfig.isLoop),
    [isLoop, pronunciationConfig.isLoop],
  )
  const src = useMemo(() => generateWordSoundSrc(word, pronunciationConfig.type), [word, pronunciationConfig.type])
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!src) {
      setIsPlaying(false)
      return
    }

    const audio = getCachedAudio(src)
    audioRef.current = audio

    const handlePlay = () => setIsPlaying(true)
    const handleStop = () => setIsPlaying(false)

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('ended', handleStop)
    audio.addEventListener('pause', handleStop)
    audio.addEventListener('error', handleStop)

    return () => {
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('ended', handleStop)
      audio.removeEventListener('pause', handleStop)
      audio.removeEventListener('error', handleStop)
      // 切到下一个词时停掉上一个词的发音
      audio.pause()
      setIsPlaying(false)
    }
  }, [src])

  const play = useCallback(() => {
    if (!src) return
    const audio = getCachedAudio(src)
    audioRef.current = audio
    void playWithRetry(audio, {
      volume: pronunciationConfig.volume,
      rate: pronunciationConfig.rate,
      loop,
    })
  }, [src, loop, pronunciationConfig.volume, pronunciationConfig.rate])

  const stop = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  return { play, stop, isPlaying }
}

export function usePrefetchPronunciationSound(word: string | undefined) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)

  useEffect(() => {
    if (!word) return
    prefetchPronunciation(generateWordSoundSrc(word, pronunciationConfig.type))
  }, [pronunciationConfig.type, word])
}
