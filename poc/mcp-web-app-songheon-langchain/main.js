/* ───────────── OAuth 관련 함수 ───────────── */
// OAuth 설정 파일 경로
const path = require("path");
const fs = require("fs");
const { RunnableSequence, RunnableLambda } = require("@langchain/core/runnables");
const HOME_DIR = process.env.HOME || process.env.USERPROFILE;
const CONFIG_DIR = path.join(HOME_DIR, '.gmail-mcp');
const OAUTH_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

// OAuth 클라이언트 설정 (발급자용 설정 활용)
const OAUTH_CLIENT_ID = "707596761486-2nanfg75jmj5c05jqndshb7splbuei8a.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = "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";
const OAUTH_REDIRECT_URI = "http://localhost:3000/oauth2callback";


const COMMAND_SPLIT_PROMPT = `You are an expert at analyzing complex user requests and deciding how to process them optimally.

Instructions:
- First, review the user request carefully and also review the provided list of available tools.
- If any available tool can be used to fulfill part or all of the request, you must split the request into steps.
- Even if only one tool is needed, you must still output the result in "mode": "steps" format (NOT using tool_calls directly).
- Each step must correspond exactly to one tool execution.
- Use the provided available tools list to guide your step splitting. Do not invent new tools.
- If none of the available tools are appropriate for any part of the request, provide a final natural-language response instead.
- Every request must produce a valid, non-empty JSON output.
- Do not use "tool_calls" — always structure output manually under "steps" if tools are involved.

Json Output Format:

For natural-language response (no tools needed):
{
  "mode": "natural",
  "response": "<Write your helpful answer here>"
}

For step-by-step tool usage (even if only one step):
{
  "mode": "steps",
  "steps": [
    {
      "step": 1,
      "instruction": "<Write the task to be performed using a tool>"
    },
    {
      "step": 2,
      "instruction": "<Write the task to be performed using a tool>"
    }
  ]
}

Examples:

User Request: "Summarize the document.txt file"

Output:
{
  "mode": "steps",
  "steps": [
    {
      "step": 1,
      "instruction": "Summarize the document.txt file."
    }
  ]
}

User Request: "What is the population of South Korea?"

Output:
{
  "mode": "natural",
  "response": "As of 2024, the population of South Korea is approximately 51 million."
}

User Request: "Add an event to Google Calendar for June 2, and check events for May 3."

Output:
{
  "mode": "steps",
  "steps": [
    {
      "step": 1,
      "instruction": "Add an event to Google Calendar for June 2."
    },
    {
      "step": 2,
      "instruction": "List the events on Google Calendar for May 3."
    }
  ]
}

Important:
- Always use "mode": "steps" when any tool is needed.
- Never output tool_calls or invoke tools directly.
- Output must always be valid JSON format.

Now, based on the user request below, produce the appropriate JSON output.
`;

const SELECT_TOOL_PROMPT =`You are an expert assistant that selects the most appropriate MCP Tool to execute a specific task step, based on the user's request and previous context.

Instructions:
- Carefully review the Current Step, Previous Step, and Previous Result.
- Carefully review the provided list of available MCP Tools (via system message separately).
- If any MCP Tool matches the Current Step, you MUST respond using a tool_call JSON format.
- If no tools are appropriate, you MUST respond with a normal text response (content).
- Every request must result in a non-empty, valid response — either a tool_call or a natural content reply.

Guidelines:
1. TOOL CALL
   • If a tool is suitable for the task (e.g., filesystem access: reading, writing, listing files, etc.), respond using a tool_call JSON structure.
   • Use exactly one tool per step, matching the provided tool names and schemas.
   • Never invent new tools or modify tool schemas arbitrarily.
   • If the user specified "/", ".", or left the path empty, treat it as the current project root directory ("./").

2. TEXT RESPONSE
   • If the task is purely conversational, general knowledge, reasoning, or not requiring any MCP tool, respond with a normal text response.
   • Answer helpfully and in Korean unless specifically asked for another language.

3. CONTEXT USAGE
   • Always consider the Previous Step and Previous Result.
   • Use Previous Result as needed to fill missing fields like content, body, filename, etc.

4. FOLLOW-UP QUESTIONS
   • If a required parameter is missing or ambiguous, ask the user a clarifying question rather than guessing.

Output Behavior:
- If a tool is needed, you must respond with a tool_call JSON format.
- If no tool is needed, respond using normal assistant message content.
- Never return an empty response.

Response Format:
- For tool_call: respond in tool_call format (OpenAI Function Calling).
- For natural language reply: respond with a non-empty content field (normal assistant message).

Important:
- Prioritize using available MCP Tools whenever possible.
- Do not emit both a tool_call and a content reply together — only one must be chosen appropriately.

Choose the best action based on the above and the available tools.
`;

// OAuth 인증 관리 함수
async function runOAuthAuthentication() {
    // 인증 디렉토리 생성
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // OAuth 클라이언트 생성
    const oauth2Client = new OAuth2Client(
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_REDIRECT_URI
    );

    // OAuth 상세 정보를 키 파일로 저장
    const oauthKeysContent = {
        "installed": {
            "client_id": OAUTH_CLIENT_ID,
            "project_id": "mcp-gmail-connection",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": OAUTH_CLIENT_SECRET,
            "redirect_uris": [OAUTH_REDIRECT_URI]
        }
    };

    // OAuth 키 파일 저장
    fs.writeFileSync(OAUTH_PATH, JSON.stringify(oauthKeysContent, null, 2));
    log(`OAuth keys saved to: ${OAUTH_PATH}`);

    // HTTP 서버 시작
    const server = http.createServer();
    server.listen(3000);
    log('Local server started on port 3000');

    return new Promise((resolve, reject) => {
        // 인증 URL 생성
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/gmail.modify',
              'https://www.googleapis.com/auth/calendar'
            ],
        });

        log('Opening browser for authentication...');
        // 브라우저로 인증 페이지 열기
        open(authUrl);

        // 콜백 처리
        server.on('request', async (req, res) => {
            if (!req.url?.startsWith('/oauth2callback')) return;

            const url = new URL(req.url, 'http://localhost:3000');
            const code = url.searchParams.get('code');

            if (!code) {
                res.writeHead(400);
                res.end('No code provided');
                reject(new Error('No code provided'));
                return;
            }

            try {
                // 콜백에서 코드를 받아서 토큰 요청
                const { tokens } = await oauth2Client.getToken(code);
                oauth2Client.setCredentials(tokens);
                
                // 권한 정보 저장
                fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(tokens, null, 2));
                log(`Credentials saved to: ${CREDENTIALS_PATH}`);

                // 성공 페이지 응답
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                            <h1 style="color: #4285F4;">Authentication Successful!</h1>
                            <p>Google 계정 인증이 완료되었습니다.</p>
                            <p>이 창을 닫고 앱으로 돌아가세요.</p>
                        </body>
                    </html>
                `);
                
                // 서버 종료 및 성공 반환
                server.close();
                resolve({ success: true, tokens });
            } catch (error) {
                res.writeHead(500);
                res.end('Authentication failed');
                server.close();
                reject(error);
            }
        });

        // 서버 오류 처리
        server.on('error', (error) => {
            log(`Server error: ${error.message}`);
            reject(error);
        });
    });
}/****************************************************************
 *  MCP-Web-App – 메인 프로세스 진입점
 *
 *  ▸ 이 파일은 Electron ‘메인 프로세스’에서 실행된다.
 *  ▸ 역할
 *      1) Electron 윈도우 생성 및 애플리케이션 생명주기 관리
 *      2) MCP 서버(여기서는 Filesystem 서버) 스폰 & RPC 통신
 *      3) OpenAI LLM 호출 → “어떤 MCP 툴을 쓸지” 의사결정
 *      4) Renderer(브라우저) ↔ Main 간 IPC 브리지
 *
 *  ⚠️  NOTE
 *      ─ Electron 구조
 *          • Main  : Node.js 런타임, OS 자원 접근 가능
 *          • Renderer : Chromium, DOM 렌더링 / 사용자 UI
 *          • Preload  : 둘 사이를 안전하게 중재(contextIsolation)
 *
 *      ─ MCP 서버
 *          • `@modelcontextprotocol/server-filesystem` 바이너리를
 *            자식 프로세스로 띄우고, stdin/stdout을 통해 JSON-RPC 사용
 ****************************************************************/

require("dotenv").config(); // .env 로부터 환경변수 로드
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const spawn = require("cross-spawn"); // cross-platform child_process
const axios = require("axios"); // OpenAI REST 호출
const portfinder = require("portfinder"); // (지금은 미사용) 여유 포트 찾기
const { v4: uuid } = require("uuid"); // JSON-RPC id 생성용
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const open = require('open').default;
const http = require('http');

/* ───────────── Logger 헬퍼 ───────────── */
const ts = () => new Date().toISOString();
const log = (...a) => console.log(ts(), "[INFO ]", ...a);
const warn = (...a) => console.warn(ts(), "[WARN ]", ...a);
const err = (...a) => console.error(ts(), "[ERROR]", ...a);

/* ───────────── StdioRPCClient 클래스 ─────────────
   MCP 서버와의 JSON-RPC 통신을 캡슐화한다.
   ▸ stdin.write() 로 요청 전송
   ▸ stdout ‘\n’ 단위로 버퍼링하여 응답 파싱
   ▸ id-Promise 매핑을 Map 으로 관리(pending)
────────────────────────────────────────── */
class StdioRPCClient {
  constructor(proc, tag) {
    this.proc = proc; // child_process 인스턴스
    this.tag = tag; // 로그 식별용 라벨
    this.pending = new Map(); // { id → {resolve, reject} }

    /* --- 데이터 수신 핸들러 등록 --- */
    this.buffer = "";
    proc.stdout.on("data", (d) => this.#onData(d));

    /* --- STDERR → 로그로 라우팅 (서버 에러/경고) --- */
    proc.stderr.on("data", (d) =>
      d
        .toString()
        .split(/\r?\n/)
        .forEach((l) => {
          if (!l) return;
          if (l.startsWith("Secure MCP") || l.startsWith("Allowed"))
            log(`[${this.tag}]`, l); // 정상 안내 메시지
          else err(`[${this.tag}!]`, l); // 실제 오류
        })
    );
    proc.on("exit", (c) => warn(`[${tag}] exited`, c));
  }

  /* stdout 버퍼 처리 – 한 줄(JSON)씩 분해하여 Promise resolve */
  #onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;

      try {
        const msg = JSON.parse(line); // {"jsonrpc":"2.0", id, ...}
        const p = this.pending.get(msg.id); // 대기중인 호출 찾기
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(msg.error) : p.resolve(msg.result);
        }
      } catch (e) {
        err(`[${this.tag}] broken JSON`, line);
      }
    }
  }

  /* JSON-RPC 메서드 호출 래퍼 (Promise 반환) */
  call(method, params = {}) {
    const id = uuid();
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(payload) + "\n");
    });
  }
}

/* ───────────── 0. MCP 서버 정의 ─────────────
   여러 서버를 선택적으로 돌릴 수 있도록 배열로 보관
   (Filesystem 서버와 Gmail 서버)
   기존에 만들어져있던 서버를 설치하여 사용할 경우 서버를 설치한 뒤
   SERVER_DEFS에 서버를 추가하면 실행 시 이 배열 내부를 돌면서 필요한 서버의 정보를 취득함.
────────────────────────────────────────── */
const SERVER_DEFS = [
  {
    id: "fs", // 툴 alias 접두사
    name: "Filesystem",
    bin:
      process.platform === "win32" // OS 별 실행 파일
        ? "mcp-server-filesystem.cmd"
        : "mcp-server-filesystem",
    allowedDir: process.cwd(), // 루트 디렉터리 기본값
  },
  {
    id: "gmail", // 툴 alias 접두사
    name: "Gmail",
    bin:
      process.platform === "win32"
        ? "gmail-mcp.cmd"
        : "gmail-mcp",
  },
  {
    id: "calendar",
    name: "Google Calendar",
    bin: process.platform === "win32" 
      ? "google-calendar-mcp.cmd" 
      : "google-calendar-mcp",
  }
];

/* ───────────── 1. 런타임 상태 ───────────── */
const servers = []; // [{ id, name, proc, rpc, tools[], allowedDir }]

/* ───────────── 2. 서버 스폰 & 툴 로딩 ───────────── */
async function spawnServer(def) {
  const binPath = path.join(__dirname, "node_modules", ".bin", def.bin);
  const args = def.args || [];
  if (!fs.existsSync(binPath)) {
    err("not found", binPath);
    return null;
  }

  log(`Spawning ${def.id}`, binPath, def.allowedDir);
  /* child_process.spawn
     stdio = [stdin, stdout, stderr] 모두 파이프로 연결 */
  const proc = spawn(binPath, [def.allowedDir], {
    cwd: def.allowedDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rpc = new StdioRPCClient(proc, def.id);
  const srv = { ...def, proc, rpc, tools: [] };
  await refreshTools(srv); // list_tools → API 스키마 획득
  servers.push(srv);

  /* aliasMap 은 툴 호출 이름 → {srvId, method} 매핑 */
  aliasMap.clear(); // 서버 재시작 시 새로 갱신
  return srv;
}

/* 서버에서 지원하는 툴 목록 가져와서 (서버별) 저장 */
async function refreshTools(srv) {
  try {
    // 서버 버전에 따라 list_tools 또는 tools/list 지원
    let raw;
    try {
      raw = await srv.rpc.call("list_tools");
    } catch {
      raw = await srv.rpc.call("tools/list");
    }

    // 다양한 응답 형식을 배열로 정규화
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (raw?.tools) arr = raw.tools;
    else if (typeof raw === "object") arr = Object.values(raw);

    if (!arr.length) throw new Error("no tools found");

    /* name 충돌 방지를 위해 “srvid_toolname” 으로 alias 부여 */
    srv.tools = arr.map((t) => ({
      ...t,
      name: `${srv.id}_${t.name}`,
      _origMethod: t.name, // 실제 서버 측 메서드 기억
    }));

    log(
      `Tools[${srv.id}] loaded`,
      srv.tools.map((t) => t.name)
    );
  } catch (e) {
    err("tool load failed", e.message);
  }
}

/* 모든 서버의 툴 평탄화(Prompts에서 tools 필드로 넘김) */
function allTools() {
  return servers.flatMap((s) => s.tools);
}

/* OpenAI ChatGPT v2 “function calling” 스펙용 변환 */
function formatToolV2(t) {
  // aliasMap : 호출 시 역-매핑하기 위해 보관
  aliasMap.set(t.name, {
    srvId: t.name.split("_", 1)[0],
    method: t._origMethod,
  });

  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema ||
        t.parameters || {
          type: "object",
          properties: {},
        },
    },
  };
}

const aliasMap = new Map(); // {alias → {srvId, method}}

/* ─────────── 3. OpenAI → 사용자의 명령을 여러 단계로 분할할 ─────────────
   ① 유저 프롬프트, ② 서버 툴 스키마 → Chat Completions 호출
   ▸ LLM 결과는 배열 형태로 명령 처리 단계 응답답
────────────────────────────────────────── */
async function splitIntoSteps(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: COMMAND_SPLIT_PROMPT },
        { role: "user", content: prompt }
      ],
      tools: allTools().map(formatToolV2),
      max_tokens: 1024
    },
    { headers: { Authorization: `Bearer ${key}` } }
  );

  const content = res.data.choices[0].message.content?.trim();
  if (!content) {
    return { earlyExit: true, message: "No content received from LLM." };
  }

  try {
    const parsed = JSON.parse(content);

    if (parsed.mode === "steps" && Array.isArray(parsed.steps)) {
      return { earlyExit: false, steps: parsed.steps };
    } else if (parsed.mode === "natural" && typeof parsed.response === "string") {
      return { earlyExit: true, message: parsed.response };
    } else {
      // mode가 없거나 예상치 못한 형식이면 그냥 content를 반환
      return { earlyExit: true, message: content };
    }
  } catch (e) {
    // JSON 파싱 실패한 경우 자연어 content 그대로 반환
    return { earlyExit: true, message: content };
  }
}



/* ─────────── 4. OpenAI → 어떤 툴 쓸지 결정 또는 직접 응답 ─────────────
   ① 유저 프롬프트, ② 서버 툴 스키마 → Chat Completions 호출
   ▸ LLM 결과가 "tool_call" 이면 RPC 실행, 아니면 텍스트 그대로 응답
────────────────────────────────────────── */
async function selectToolForStep(currentStep, previousStep, previousResult) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: SELECT_TOOL_PROMPT,
        },
        {
          role: "user",
          content: `
Current Step: ${currentStep}
Previous Step: ${previousStep ?? "None"}
Previous Result: ${previousResult ?? "None"}
          `
        }
      ],
      tools: allTools().map(formatToolV2), // MCP 툴 목록 넘겨줌
      tool_choice: "auto",
      max_tokens: 1024,
    },
    { headers: { Authorization: `Bearer ${key}` } }
  );

  log("[LLM] raw response:", JSON.stringify(res.data, null, 2));
  const msg = res.data.choices[0].message;

  /* ─ OpenAI 2024 이후 포맷: message.tool_calls[] ─ */
  let fc = null;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length)
    fc = msg.tool_calls[0].function;
  /* ─ 레거시(v1) 포맷: function_call ─ */ else if (msg.function_call)
    fc = msg.function_call;

  // 툴 호출이 없으면 텍스트 응답 (일반 질문으로 처리)
  if (!fc || !fc.arguments) return { type: "text", content: msg.content ?? "" };

  // 툴 인자 JSON 파싱
  let parsed;
  try {
    parsed = JSON.parse(fc.arguments);
  } catch {
    err("Failed to parse tool arguments:", fc.arguments);
    return { type: "text", content: msg.content ?? "" };
  }

  const alias = fc.name; // e.g. fs_directory_tree
  const params = parsed.params || parsed; // (서버 마다 다름)

  /* ───── 경로 보정 ─────
    LLM이 '/'·'.'·'' 같이 루트 의미로 응답하면
    MCP 서버 쪽엔 '.'(allowedDir)로 넘겨서
    "허용된 디렉터리 바깥" 오류를 방지 */
  if (typeof params.path === "string") {
    const p = params.path.trim();
    if (p === "/" || p === "\\" || p === "." || p === "") {
      params.path = "."; // Filesystem 서버는 '.'을 프로젝트 루트로 해석
    }
  }

  const map = aliasMap.get(alias);
  if (!map) {
    err("Unmapped tool alias:", alias);
    return { type: "text", content: msg.content ?? "" };
  }

  // RPC 실행 정보 반환
  return {
    type: "rpc",
    srvId: map.srvId,
    method: map.method,
    params,
  };

}


/* ───────────── 5. Electron 윈도우 생성 ───────────── */
let mainWindow;
function createWindow() {
  log("createWindow");
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // contextBridge 코드
      contextIsolation: true, // Renderer → Main 완전 격리
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  
  // 개발자 도구 콘솔 오픈
  mainWindow.webContents.openDevTools();
}

/* ───────────── 6. IPC 라우팅 ─────────────
   Renderer → Main
     'select-folder' : 폴더 선택 다이얼로그 열기
     'run-command'   : 사용자 자연어 명령 처리
     'google-auth'   : Google OAuth 인증 수행
     'gmail-spawn'   : Gmail mcp 서버 띄우는 과정
     'calendar-spawn' : Calendar mcp 서버 띄우는 과정
────────────────────────────────────────── */
ipcMain.handle("select-folder", async () => {
  // ① OS 폴더 선택 UI
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (r.canceled) return null;

  const dir = r.filePaths[0];
  log("folder selected", dir);

  /* ② 기존 fs 서버 종료 → 새 allowedDir 로 재시작 */
  const idx = servers.findIndex((s) => s.id === "fs");
  if (idx >= 0) {
    servers[idx].proc.kill();
    servers.splice(idx, 1);
  }
  await spawnServer({ ...SERVER_DEFS[0], allowedDir: dir });
  return dir;
});

ipcMain.handle("oauth-auth", async () => {
  log("[IPC] oauth-auth 시작");

  try {
    const authResult = await runOAuthAuthentication();

    if (authResult.success) {
      log("[OAuth] 인증 성공");
      return { success: true };
    } else {
      throw new Error("OAuth 인증 실패");
    }
  } catch (e) {
    err("OAuth 인증 실패", e);
    return {
      success: false,
      message: e.message,
    };
  }
});

// Google 인증 처리를 위한 새 IPC 핸들러
ipcMain.handle("gmail-spawn", async () => {
  log("[IPC] gmail-auth 시작");
  try {
    const gmailServerDef = SERVER_DEFS.find(s => s.id === "gmail");
    // 이미 실행 중이면 종료
    const gmailServerIdx = servers.findIndex((s) => s.id === "gmail");
    if (gmailServerIdx >= 0) {
      log(`기존 Gmail 서버 종료`);
      servers[gmailServerIdx].proc.kill();
      servers.splice(gmailServerIdx, 1);
    }
    
    const server = await spawnServer(gmailServerDef);
        
    if (server) {
      log(`Gmail 서버 스폰 성공: ${server.id}`);
      return { 
        success: true, 
        message: "Google 계정 인증이 완료되었습니다. 이제 Gmail 기능을 사용할 수 있습니다." 
      };
    } else {
      throw new Error("Gmail 서버 시작 실패");
    }
  } catch (e) {
    err("Gmail 서버 스폰 실패", e);
    return {
      success: false,
      message: e.message,
    };
  }
});

// Google Calendar 서버를 띄우는 IPC 핸들러
ipcMain.handle("calendar-spawn", async () => {

  try {
    const calendarServerDef = SERVER_DEFS.find(s => s.id === "calendar");
    const calendarServerIdx = servers.findIndex((s) => s.id === "calendar");

    // 만약 기존 calendar 서버가 떠있으면 종료
    if (calendarServerIdx >= 0) {
      log("기존 Calendar 서버 종료");
      servers[calendarServerIdx].proc.kill();
      servers.splice(calendarServerIdx, 1);
    }

    const server = await spawnServer(calendarServerDef);

    if (server) {
      log(`Calendar 서버 스폰 성공: ${server.id}`);
      return { 
        success: true, 
        message: "Google Calendar 인증이 완료되었습니다. 이제 Calendar 기능을 사용할 수 있습니다." 
      };
    } else {
      throw new Error("Calendar 서버 시작 실패");
    }
  } catch (e) {
    err("Calendar auth failed", e);
    return { 
      success: false, 
      message: `Calendar 인증 중 오류 발생: ${e.message}`,
      error: e.message 
    };
  }
});


// MCP Tool 호출 함수
async function callMcpTool(server, tool, args) {
  
  log("call Tool : ", server, tool, args)
  const srv = servers.find((s) => s.id === server);
  if (!srv) throw new Error(`server ${server} not found`);

  const payload = { name: tool, arguments: args };
  log("[RPC] calling MCP tool:", payload);

  try {
    const res = await srv.rpc.call("call_tool", payload);
    return typeof res === "object" ? JSON.stringify(res) : String(res);
  } catch (err) {
    if (err.code === -32601) {
      log("[RPC] fallback to tools/call");
      const res = await srv.rpc.call("tools/call", payload);
      return typeof res === "object" ? JSON.stringify(res) : String(res);
    } else {
      throw err;
    }
  }
}


ipcMain.handle("run-command", async (_e, prompt) => {
  log("[IPC] run-command (LangChain style)", prompt);

  try {

    const splitResult = await splitIntoSteps(prompt);
    log("Split steps:", splitResult);

    if (splitResult.earlyExit) {
      const response = splitResult.message;
      console.log("[Shortcut] Natural language answer detected:", response);
      return { result: response };
    }

    
    const steps = await splitIntoSteps(prompt);
    log("Split steps:", steps.steps);

    // 초기 상태 정의
    let state = {
      previousStep: null,
      previousResult: null,
      accumulatedLogs: []
    };

    for (const step of steps.steps) {
      const runnable = RunnableLambda.from(async (input) => {

        const { previousStep, previousResult, accumulatedLogs, step } = input;

        const d = await selectToolForStep(step.instruction, previousStep, previousResult);

        let result;

        // 일반 질문인 경우 - 텍스트 응답을 바로 반환
        if (d.type === "text") { result = d.content }
        else{
          // MCP 도구 호출이 필요한 경우 - 기존 코드
          result = await callMcpTool(d.srvId, d.method, d.params);
        }

        return {
          previousStep: step,
          previousResult: result,
          accumulatedLogs: [
            ...accumulatedLogs,
            { step: step.instruction, result: result?.substring(0, 50) ?? "(no result)" }
          ]
        };
      });

      state = await runnable.invoke({ ...state, step });
    }

    // 요약 후 자연어 응답 생성
    const executionSummary = state.accumulatedLogs
      .map(log => `• ${log.step}: ${log.result}`)
      .join("\n");

    const finalRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
You are a helpful assistant. The user made a request involving multiple tools.
Here is the execution summary:

${executionSummary}

Now produce a single, concise, natural-language response in Korean.
            `
          }
        ]
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const friendly = finalRes.data.choices[0].message.content.trim();
    log("[POST-PROCESS] final friendly answer:", friendly);
    return { result: friendly };

  } catch (e) {
    err("run-command chain fail", e);
    return { error: e.message };
  }
});



/* ───────────── 6. Electron App 생명주기 ───────────── */
app.whenReady().then(async () => {
  log("Electron ready");
  // Filesystem 서버만 시작 (Gmail은 인증 버튼 클릭 시 시작)
  await spawnServer(SERVER_DEFS.find(s => s.id === "fs"));
  createWindow();
});
app.on("will-quit", () => servers.forEach((s) => s.proc.kill()));
