/**
 * GitHub Pages 的项目站点部署在 /<repo-name>/ 子路径下 (如 /my-qwerty-learner/)。
 *
 * 上游把 '/qwerty-learner' 这个前缀写死在多处 (路由 basename、词典 URL、音效 URL),
 * 一旦仓库名不同, 词典/音效全部 404、路由失效。这里按实际访问路径统一推导基路径,
 * 使本项目部署到任意仓库名/任意路径下都能正常工作。
 */
export function getDeployBasePath(): string {
  if (typeof window === 'undefined') return ''
  if (REACT_APP_DEPLOY_ENV !== 'pages') return ''

  // 项目站点形如 https://<user>.github.io/<repo>/..., 取第一段作为基路径
  const firstSegment = window.location.pathname.split('/')[1] ?? ''
  return firstSegment ? `/${firstSegment}` : ''
}
