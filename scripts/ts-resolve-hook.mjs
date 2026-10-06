/**
 * fixture 실행 전용 모듈 해석 hook.
 *
 *   왜 필요한가: 제품 코드(lib/**)는 Next/tsc 규칙대로 확장자 없이 상대 import 한다
 *   (`import { x } from './aggregate'`). 반면 Node ESM 은 확장자를 요구하므로
 *   `node scripts/verify_*.mts` 로 돌릴 때 ERR_MODULE_NOT_FOUND 가 난다.
 *
 *   이 hook 은 확장자 없는 상대 specifier 에 `.ts` → `.tsx` → `/index.ts` 를 차례로 붙여
 *   해석을 재시도한다. 또 tsconfig 의 `@/` 별칭을 프로젝트 루트로 바꿔 준다.
 *
 *   ⚠ 테스트 실행 편의 전용이다. 제품 빌드·런타임에는 전혀 관여하지 않는다.
 *   ⚠ 코드를 변환하지 않는다(TypeScript 제거는 Node 가 기본으로 한다).
 */
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
const hasExtension = (s) => /\.[cm]?[jt]sx?$/i.test(s);

export async function resolve(specifier, context, nextResolve) {
  // tsconfig 별칭: '@/lib/x' → '<root>/lib/x'
  let spec = specifier;
  if (spec.startsWith('@/')) {
    spec = pathToFileURL(resolvePath(projectRoot, spec.slice(2))).href;
  }

  const relative = spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('file:');
  if (relative && !hasExtension(spec)) {
    for (const ext of CANDIDATES) {
      try {
        return await nextResolve(spec + ext, context);
      } catch {
        // 다음 후보로.
      }
    }
  }
  return nextResolve(spec, context);
}
