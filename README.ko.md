# paseo-link-fallback (파일 링크 보정)

[English](README.md)

에이전트 답변의 파일 링크가 실제 경로와 정확히 맞지 않아도 열리게 해주는 [Paseo](https://paseo.sh) 플러그인. 예: 워크스페이스 루트 기준 경로, 다른 체크아웃 경로, 공백이 있는 파일명.

## 설치

```bash
paseo plugin add git:nasus1263/paseo-link-fallback
```

데몬에서 플러그인이 켜져 있어야 한다(**Settings → Plugins → Enable plugins**). Paseo `>=0.15.4`.

## 사용법

설정 없음. 완료된 답변에 자동 적용된다. 아래 순서로 파일을 찾는다.

1. 적힌 경로 그대로(절대 경로 또는 에이전트 cwd 기준)
2. 워크스페이스 루트 기준, 그다음 경로 끝부분
3. 워크스페이스 안의 같은 이름 파일(폴더가 가장 많이 일치하는 것, 같으면 가장 짧은 경로)

## 주의

- 링크를 고친 답변은 인라인 이미지 등 Paseo 기본 렌더러 일부 기능이 빠진다.
- 이름 검색은 `node_modules`, `.git` 등을 건너뛰며 20만 파일 또는 4초에서 멈춘다.
- 모든 처리는 데몬 PC에서만 한다. 외부 전송 없음.
- paseo-doc-ask 대화 주석이 켜져 있으면 doc-ask가 대신 처리한다.
