/**
 * 云同步的可视化提示。
 *
 * 背景: 同步错误以前只显示在"设置 → 数据设置"面板里的一行小字, 用户点完"立即同步"后
 * 很容易以为已经成功(例如换设备时忘了填 Token、Token 过期等), 但实际什么都没上传。
 * 这里用一个页面顶部的横幅把失败原因直接展示出来, 需要用户点掉或自动消失。
 */

const NOTICE_ID = 'cloud-sync-notice'

export function showSyncNotice(message: string, kind: 'error' | 'success' = 'error', autoHideMs = 12000) {
  if (typeof document === 'undefined' || !document.body) return

  let el = document.getElementById(NOTICE_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = NOTICE_ID
    el.setAttribute('role', 'alert')
    el.style.cssText = [
      'position:fixed',
      'top:16px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'max-width:min(720px, calc(100vw - 32px))',
      'padding:12px 44px 12px 16px',
      'border-radius:10px',
      'box-shadow:0 8px 24px rgba(0,0,0,.18)',
      'font-size:14px',
      'line-height:1.5',
      'cursor:pointer',
      'white-space:pre-wrap',
      'word-break:break-word',
    ].join(';')
    el.addEventListener('click', () => el?.remove())
    document.body.appendChild(el)
  }

  el.style.background = kind === 'error' ? '#fef2f2' : '#f0fdf4'
  el.style.border = kind === 'error' ? '1px solid #fca5a5' : '1px solid #86efac'
  el.style.color = kind === 'error' ? '#991b1b' : '#166534'
  el.textContent = message
  el.title = '点击关闭'

  if ((el as HTMLDivElement & { _timer?: number })._timer) {
    window.clearTimeout((el as HTMLDivElement & { _timer?: number })._timer)
  }
  ;(el as HTMLDivElement & { _timer?: number })._timer = window.setTimeout(() => el?.remove(), autoHideMs)
}

export function hideSyncNotice() {
  if (typeof document === 'undefined') return
  document.getElementById(NOTICE_ID)?.remove()
}
