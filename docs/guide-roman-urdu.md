# Quota Saver: Claude Code ka token bachat plugin

Roman Urdu ya English, jaise chahein likhein. Quota Saver tokens wahan bachata hai jahan wo asal mein kharch hote hain.

## Kya karta hai

| Feature | Kaise bachata hai |
|---|---|
| **Output diet** | Bash, test, build aur web ka lamba output (hazaron lines) shuru, aakhir aur error lines tak chhota kar deta hai, phir hi wo conversation mein jaata hai. Ye output har agle message ke saath dobara nahi jaata. |
| **Read guard** | Bari file poori parhne se rokta hai (pehle search, phir sirf zaroori lines). Jo file pehle parh li aur badli nahi, wo dobara nahi parhi jaati. |
| **Auto task samajh** | "login ka error theek karo", "ye samjhao", "tests chalao": prompt dekh kar khud mukhtasar hidayat saath bhejta hai. Koi command yaad rakhne ki zaroorat nahi. |
| **Local dictionary** | `/yaad dp = staging pe deploy karo, pehle tests` save karein, phir sirf `dp` ya jumle mein `#dp` likhein. Expand aapki machine par hota hai. |
| **Local jawab cache** | Jo sawal pehle pooch chuke hain (aur us waqt koi file nahi badli), us ka jawab local se aata hai: **0 tokens**. Spelling ka farq ("kia ha" / "kya hai") bhi pehchaanta hai. Naya jawab chahiye to shuru mein `!` lagayein. |
| **Smart handoff** | `/naya-kaam`: sasta model (Haiku) poore session ka 12-line khulasa banata hai, context saaf karta hai, aur khulasa aage le jaata hai. `/wapas` agle din wahi khulasa load karta hai, poori history nahi. |
| **Sasta explorer** | Codebase mein bari talaash `quota-saver:explorer` agent karta hai, jo sasta model (Haiku) use karta hai. |
| **Context + quota meter** | Status line mein `ctx 42% · 5h 30% · saved ~12k tok` dikhta hai. 65% aur 85% par yaad dilata hai. |
| **Lean rules** | Claude ko har dafa chhoti hidayat jaati hai: mukhtasar jawab, recap nahi, search pehle. |
| **Local model (Ollama)** | Aam sawal ("docker kya hai?") aapki machine ke model par chalte hain: **0 Claude tokens**. Default band hai, `/local on` se chalu hota hai. |

## On / Off

| Command | Kaam |
|---|---|
| `/quota-saver off` | Poora plugin band: sab kuch normal Claude jaisa |
| `/quota-saver on` | Wapas chalu |
| `/local on` | Sirf `~` se shuru hone wale prompts local model par jaate hain, misal `~git rebase kya hai` |
| `/local auto` | `~` ke ilawa wo aam sawal bhi local par jaate hain jin mein file ya project ka zikr na ho |
| `/local off` | Local model band (default) |
| `/local model llama3.2:3b` | Doosra local model chuno |
| `/local` | Halat check karo: Ollama chal raha hai ya nahi, kaunse models hain |

Ye settings yaad rehti hain, har session mein dobara set nahi karni partin. Kisi ek prompt ko seedha Claude ke paas bhejne ke liye shuru mein `!` lagayein: ye cache aur local model dono ko chhor deta hai.

### Local model setup: khud hota hai

Haath se kuch nahi karna. Plugin install karte waqt ek sawal aata hai, **Local model (Ollama) setup**:

- `yes`: pehle session mein plugin khud Ollama install karega, chalu karega, model download karega aur local mode on kar dega. Progress status line par dikhegi.
- `ask` (default): pehle session mein ek dafa poochega.
- `no`: band rahega. Baad mein `/local on` likhein, sab khud ho jaayega.

Mac par Homebrew se install hota hai (warna seedha download). Windows par winget se (warna installer), aur Linux par install script se.

Kamzor PC (GPU ke baghair) par har jawab mein 5-20 second lag sakte hain. Is se bhi chhota model `qwen2.5:1.5b` hai. Code badalne wala kaam hamesha Claude karta hai, local model sirf aam sawalon ke jawab deta hai.

## Commands (sab optional)

| Command | Kaam |
|---|---|
| `/quota-saver` | Kitne tokens bache, context aur quota ki halat |
| `/naya-kaam [agla kaam]` | Khulasa banao aur context saaf karo |
| `/wapas` | Pichhla khulasa load karo |
| `/yaad naam = matlab` | Shortcut save karo (`/yaad` akela: list dikhata hai) |
| `/bhool naam` ya `/bhool cache` | Shortcut ya local cache mitao |
| `/theek`, `/samjhao`, `/test-chalao`, `/jaanch`, `/banao` | Tayyar lean prompts (auto-detect ki wajah se zaroori nahi) |
| `/chhota` | Baqi conversation mein bohat mukhtasar jawab |

## Install (Mac, Windows, Linux, VS Code)

Poore step by step tareeqe ke liye [INSTALL.md](../INSTALL.md) dekhein.

Plugin Claude Code ke andar chalta hai, is liye Node, Python ya koi aur cheez install karne ki zaroorat nahi. English README: [../README.md](../README.md)

**Is folder se (apni machine par):**

```
claude plugin marketplace add /path/to/quota-saver
claude plugin install quota-saver@quota-saver
```

**GitHub se (kisi bhi PC par), repo push karne ke baad:**

```
/plugin install quota-saver --marketplace mtrsiddiqui94/quota-saver
```

Phir `y` dabayein aur scope chunein. VS Code ka Claude Code extension bhi wahi plugins use karta hai.

## Settings

`/config` mein `quota-saver` ki rows:

- `maxOutputChars` (6000): is se lamba output chhota hota hai
- `maxReadKB` (80): is se bari file poori parhne se pehle search ka kaha jaata hai
- `dedupeReads`, `autoIntent`, `localCache`: har feature alag se on/off
- `ollamaUrl` (http://localhost:11434): local model server ka pata

## Zyada bachat ki aadatein

1. Har naye kaam par `/naya-kaam` chalayein. Purani history quota ka sab se bara kharch hai.
2. Aasaan kaam ke liye `/model sonnet` ya `/model haiku`.
3. Prompt mein file ka naam de dein: "auth.ts mein login function", taake Claude ko dhoondna na pare.
