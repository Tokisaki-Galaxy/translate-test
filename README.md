<div align="center">

# ✦ Sentens

<p>
  <img src="https://img.shields.io/github/actions/workflow/status/Tokisaki-Galaxy/Sentens/copilot-setup-steps.yml?style=for-the-badge&logo=github-actions&logoColor=white&label=CI" alt="CI Status" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" />
</p>

<p>
  <img src="https://img.shields.io/badge/AI_Grading-OpenAI_Compatible-412991?style=for-the-badge&logo=openai&logoColor=white" alt="AI Grading" />
  <img src="https://img.shields.io/badge/Storage-IndexedDB_(Dexie)-FF6B35?style=for-the-badge&logo=databricks&logoColor=white" alt="Dexie" />
  <img src="https://img.shields.io/badge/Animation-Framer_Motion-EF0076?style=for-the-badge&logo=framer&logoColor=white" alt="Framer Motion" />
</p>

<p><em>AI-powered sentence translation practice · 智能翻译练习平台</em></p>

<p>
  <a href="#english">📖 English</a> &nbsp;·&nbsp;
  <a href="#chinese">📖 中文</a>
</p>

</div>

---

<a id="english"></a>

## 📖 English

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Development](#development)

---

### Overview

**Sentens** (formerly *PolyglotTest*) is a web application for practising sentence-level translation from English to Chinese. You paste a passage, the app splits it into individual sentences, you translate each one, and an LLM grades your work—returning a numerical score plus targeted feedback.

Scores are **length-weighted** across the whole session so that harder (longer) sentences contribute more to your final grade.

---

### Features

| Feature | Description |
|---|---|
| 🤖 **AI Grading** | Sends each translation to an OpenAI-compatible model and receives a `score \| feedback` response |
| 🎚️ **Difficulty Levels** | Standard (CET-4/6), Academic (postgraduate / IELTS / TOEFL), Professional (GRE / CATTI) |
| 📂 **Session Management** | Create named sessions; every sentence is persisted in IndexedDB |
| ⭐ **Favorites** | Star any sentence to save it to a dedicated favorites list |
| 🔊 **Text-to-Speech** | Click the speaker icon to hear the original English sentence read aloud |
| 🔄 **Retry on Failure** | Grading automatically retries up to 2 times if the model returns an invalid response |
| 💾 **Backup & Restore** | Export all sessions as a `.zip` file (JSON inside); restore from the same format |
| ⚙️ **Flexible LLM Config** | Set your own API key, base URL (any OpenAI-compatible provider), and model name at runtime |
| 🎨 **Smooth Animations** | Page transitions and grading results powered by Framer Motion |

---

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| UI | [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [Lucide Icons](https://lucide.dev/) |
| Animation | [Framer Motion](https://www.framer.com/motion/) |
| Database | [Dexie (IndexedDB)](https://dexie.org/) |
| Toasts | [Sonner](https://sonner.emilkowal.ski/) |
| Backup | [JSZip](https://stuk.github.io/jszip/) |
| Testing | [Vitest](https://vitest.dev/) |
| Linting | [ESLint](https://eslint.org/) |
| Formatting | [Prettier](https://prettier.io/) |

---

### Getting Started

#### Prerequisites

- Node.js ≥ 18
- An **OpenAI-compatible API key** (OpenAI, DeepSeek, Zhipu, Moonshot, etc.)

#### Installation

```bash
git clone https://github.com/Tokisaki-Galaxy/Sentens.git
cd Sentens
npm install
```

#### Run in development mode

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

#### Build for production

```bash
npm run build
npm start
```

---

### Configuration

All settings are stored in **`localStorage`** under the key `polyglot_settings` and can be changed at any time through the ⚙️ Settings dialog without restarting the server.

| Setting | Description | Default |
|---|---|---|
| `apiKey` | Your LLM API key | *(required)* |
| `apiBase` | Base URL of the OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `model` | Model identifier (e.g. `gpt-4o`, `deepseek-chat`) | *(required)* |

The Settings dialog also includes a **"Probe models"** button that queries `GET /models` on your configured endpoint and populates a dropdown so you can pick a model without typing its name.

---

### Project Structure

```
Sentens/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── grade/route.ts      # POST /api/grade  – LLM grading endpoint
│   │   │   └── models/route.ts     # POST /api/models – model list endpoint
│   │   ├── layout.tsx              # Root layout (Inter font, Toaster)
│   │   └── page.tsx                # Main application page
│   ├── components/
│   │   ├── FavoritesSheet.tsx      # Slide-in panel listing starred sentences
│   │   ├── SettingsDialog.tsx      # API key / base URL / model configuration
│   │   └── ui/                     # Shared primitives (Button, Dialog, Sheet, Tabs…)
│   ├── lib/
│   │   ├── db.ts                   # Dexie database (sessions, sentences, favorites)
│   │   ├── grading.ts              # Response parser (4-level fallback)
│   │   ├── polyglot.ts             # Sentence segmentation, scoring, colour helpers
│   │   ├── useTTS.ts               # Web Speech API hook
│   │   └── utils.ts                # Tailwind class merge utility
│   └── mocks/                      # MSW handlers for offline development
├── public/                         # Static assets
├── next.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

### API Reference

#### `POST /api/grade`

Grades a single translation using the configured LLM.

**Request body**

```json
{
  "original":    "The quick brown fox jumps over the lazy dog.",
  "translation": "那只敏捷的棕色狐狸跳过了懒狗。",
  "apiKey":      "<your-key>",
  "apiBase":     "https://api.openai.com/v1",
  "model":       "gpt-4o",
  "level":       "standard"
}
```

`level` is optional. Accepted values: `standard` · `academic` · `professional`. Omitting it triggers automatic difficulty detection.

**Response**

```json
{ "score": 88, "feedback": "语义正确，用词自然，建议将"懒狗"改为"懒惰的狗"以更贴近原文。" }
```

#### `POST /api/models`

Fetches available models from the configured endpoint.

**Request body**

```json
{ "apiKey": "<your-key>", "apiBase": "https://api.openai.com/v1" }
```

**Response**

```json
{ "models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"] }
```

---

### Development

```bash
# Run unit tests
npm test

# Type-check
npx tsc -b

# Lint
npm run lint

# Format
npx prettier --write .

# Find unused exports / files
npx knip
```

Tests live alongside source files (`*.test.ts`) and run with **Vitest**.

---

<a id="chinese"></a>

## 📖 中文

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [项目结构](#项目结构)
- [API 接口](#api-接口)
- [开发指南](#开发指南)

---

### 项目简介

**Sentens**（原名 *PolyglotTest*）是一款基于 Web 的英译汉句子翻译练习应用。你粘贴一段英文，应用会将其切分成单句，你逐句翻译，然后由 LLM 给出数字分数和针对性反馈。

最终得分采用**句子长度加权**策略，难度更高（篇幅更长）的句子在总评中占有更大权重。

---

### 功能特性

| 功能 | 说明 |
|---|---|
| 🤖 **AI 评分** | 将翻译发送至兼容 OpenAI 协议的模型，返回 `分数 \| 反馈` |
| 🎚️ **难度档次** | 标准（四六级）、学术（考研 / 雅思 / 托福）、专业（GRE / CATTI） |
| 📂 **会话管理** | 创建命名会话，所有句子持久化至 IndexedDB |
| ⭐ **收藏夹** | 为任意句子打星，保存到专属收藏列表 |
| 🔊 **文字转语音** | 点击喇叭图标，收听原句英文朗读 |
| 🔄 **失败重试** | 若模型返回无效响应，自动最多重试 2 次 |
| 💾 **备份与恢复** | 将所有会话导出为 `.zip` 文件（内含 JSON），并可从同格式文件恢复 |
| ⚙️ **灵活的 LLM 配置** | 运行时在 Settings 对话框中设置 API Key、Base URL 及模型名称 |
| 🎨 **流畅动画** | 页面切换与评分展示均使用 Framer Motion 驱动 |

---

### 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | [Next.js 16](https://nextjs.org/)（App Router） |
| 语言 | [TypeScript 5](https://www.typescriptlang.org/) |
| UI | [React 19](https://react.dev/)、[Tailwind CSS 4](https://tailwindcss.com/)、[Radix UI](https://www.radix-ui.com/)、[Lucide 图标](https://lucide.dev/) |
| 动画 | [Framer Motion](https://www.framer.com/motion/) |
| 数据库 | [Dexie (IndexedDB)](https://dexie.org/) |
| 消息提示 | [Sonner](https://sonner.emilkowal.ski/) |
| 备份压缩 | [JSZip](https://stuk.github.io/jszip/) |
| 测试 | [Vitest](https://vitest.dev/) |
| 代码检查 | [ESLint](https://eslint.org/) |
| 格式化 | [Prettier](https://prettier.io/) |

---

### 快速开始

#### 前置要求

- Node.js ≥ 18
- 一个**兼容 OpenAI 协议的 API Key**（OpenAI、DeepSeek、智谱、Moonshot 等均可）

#### 安装

```bash
git clone https://github.com/Tokisaki-Galaxy/Sentens.git
cd Sentens
npm install
```

#### 开发模式运行

```bash
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000)。

#### 生产构建

```bash
npm run build
npm start
```

---

### 配置说明

所有设置均以 `polyglot_settings` 为键名存储于 **`localStorage`**，可随时通过 ⚙️ 设置对话框修改，无需重启服务。

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `apiKey` | LLM API 密钥 | *(必填)* |
| `apiBase` | 兼容 OpenAI 协议的接口 Base URL | `https://api.openai.com/v1` |
| `model` | 模型标识（如 `gpt-4o`、`deepseek-chat`） | *(必填)* |

设置对话框还提供**"探测模型"**按钮，会向你配置的端点请求 `GET /models` 并填充下拉列表，无需手动输入模型名称。

---

### 项目结构

```
Sentens/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── grade/route.ts      # POST /api/grade  – LLM 评分接口
│   │   │   └── models/route.ts     # POST /api/models – 模型列表接口
│   │   ├── layout.tsx              # 根布局（Inter 字体、Toaster）
│   │   └── page.tsx                # 主应用页面
│   ├── components/
│   │   ├── FavoritesSheet.tsx      # 收藏句子的侧滑面板
│   │   ├── SettingsDialog.tsx      # API Key / Base URL / 模型配置
│   │   └── ui/                     # 通用基础组件（Button、Dialog、Sheet、Tabs…）
│   ├── lib/
│   │   ├── db.ts                   # Dexie 数据库（sessions、sentences、favorites）
│   │   ├── grading.ts              # 响应解析器（四级降级解析）
│   │   ├── polyglot.ts             # 分句、评分、颜色辅助函数
│   │   ├── useTTS.ts               # Web Speech API Hook
│   │   └── utils.ts                # Tailwind 类名合并工具
│   └── mocks/                      # MSW 处理器（离线开发）
├── public/                         # 静态资源
├── next.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

### API 接口

#### `POST /api/grade`

使用已配置的 LLM 对单条翻译进行评分。

**请求体**

```json
{
  "original":    "The quick brown fox jumps over the lazy dog.",
  "translation": "那只敏捷的棕色狐狸跳过了懒狗。",
  "apiKey":      "<your-key>",
  "apiBase":     "https://api.openai.com/v1",
  "model":       "gpt-4o",
  "level":       "standard"
}
```

`level` 为可选字段，可选值：`standard`（标准）·`academic`（学术）·`professional`（专业）。省略时触发自动难度检测。

**响应**

```json
{ "score": 88, "feedback": "语义正确，用词自然，建议将"懒狗"改为"懒惰的狗"以更贴近原文。" }
```

#### `POST /api/models`

从已配置的端点获取可用模型列表。

**请求体**

```json
{ "apiKey": "<your-key>", "apiBase": "https://api.openai.com/v1" }
```

**响应**

```json
{ "models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"] }
```

---

### 开发指南

```bash
# 运行单元测试
npm test

# 类型检查
npx tsc -b

# 代码检查
npm run lint

# 格式化
npx prettier --write .

# 查找未使用的导出 / 文件
npx knip
```

测试文件紧邻源文件放置（`*.test.ts`），使用 **Vitest** 运行。

---

<div align="center">
<sub>Built with ❤️ · <a href="https://github.com/Tokisaki-Galaxy/Sentens">Tokisaki-Galaxy/Sentens</a></sub>
</div>
