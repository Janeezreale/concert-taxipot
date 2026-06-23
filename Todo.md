# 콘서트 택시팟 UI 구현 Todo

## 구현 완료

- [x] Figma 기준 화면 3개 구현
  - 홈화면
  - 콘서트 선택
  - 택시팟 만들기
- [x] Vite + React + TypeScript 프로젝트 구성
- [x] 공통 컴포넌트 구현
  - `MobileShell`
  - `AppHeader`
  - `BottomActionButton`
  - `ConcertSelectCard`
  - `TaxiPotItem`
  - `TaxiPotForm`
- [x] 더미 데이터 작성
  - 콘서트 목록
  - 초기 택시팟 3개
- [x] 로컬 상태 기반 화면 전환 구현
  - 홈
  - 콘서트 선택
  - 택시팟 생성
- [x] 콘서트 선택 후 홈 화면 값 갱신
- [x] 택시팟 등록 후 홈 목록 추가
- [x] 오픈채팅 버튼 새 탭 열기
- [x] 필수 입력값 검증
- [x] Supabase 연동 레이어 작성
  - `.env`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`가 있으면 Supabase 사용
  - 환경변수가 없으면 `localStorage` fallback 사용
- [x] Supabase 테이블 스키마 작성
  - `supabase-schema.sql`
- [x] 반응형 스타일 작성
  - 402px Figma 모바일 기준
  - 360px 이하 overflow 방지
  - 데스크톱 중앙 모바일 프레임 배치
- [x] 접근성 처리
  - 버튼은 `button` 요소 사용
  - 뒤로가기 아이콘 `aria-label` 제공
  - 입력 필드 label 연결
- [x] 빌드 검증
  - `npm run build` 통과

## 실행 방법

```bash
npm install
npm run dev
```

개발 서버 기본 주소:

```text
http://localhost:5173/
```

## Supabase 설정

`.env` 파일에 아래 값을 넣으면 Supabase를 사용합니다.

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

테이블 생성 SQL은 `supabase-schema.sql`에 있습니다.
