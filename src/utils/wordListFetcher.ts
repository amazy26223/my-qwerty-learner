import type { Word } from '@/typings'
import { getDeployBasePath } from './deployBase'

export async function wordListFetcher(url: string): Promise<Word[]> {
  const response = await fetch(getDeployBasePath() + url)
  const words: Word[] = await response.json()
  return words
}
