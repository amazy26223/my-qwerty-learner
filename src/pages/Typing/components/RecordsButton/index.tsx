import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import IconClock from '~icons/heroicons/clock-solid'

/** 「学习记录」入口：会话记录 + 时长统计（对应独立页面 /records） */
const RecordsButton = () => {
  const navigate = useNavigate()

  const toRecords = useCallback(() => {
    navigate('/records')
  }, [navigate])

  return (
    <button
      type="button"
      onClick={toRecords}
      className="flex items-center justify-center rounded p-[2px] text-lg text-indigo-500 outline-none transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white"
      title="学习记录"
    >
      <IconClock className="icon" />
    </button>
  )
}

export default RecordsButton
