# Install guide / Install karne ka tareeqa

Works on macOS, Windows and Linux, in the terminal and in VS Code.
Mac, Windows aur Linux par, terminal aur VS Code dono mein chalta hai.

## 1. Claude Code (pehle se ho to skip karein)

Claude Code installed and signed in to your Claude account.
Claude Code install ho aur aapke Claude account se login ho.

- **VS Code:** Extensions mein "Claude Code" install karein aur sign in karein.
- **Terminal, Mac / Linux:** `curl -fsSL https://claude.ai/install.sh | bash`
- **Terminal, Windows (PowerShell):** `irm https://claude.ai/install.ps1 | iex`

Check karein: `claude --version`

> VS Code extension wale Mac par `claude` command PATH mein na ho to upar wala terminal installer chala lein, ya extension ka apna binary use karein:
> `~/.vscode/extensions/anthropic.claude-code-<version>/resources/native-binary/claude`

## 2. Marketplace add karein

```
claude plugin marketplace add mtrsiddiqui94/quota-saver
```

Expected: `✔ Successfully added marketplace: quota-saver`

## 3. Plugin install karein

```
claude plugin install quota-saver@quota-saver
```

Expected: `✔ Successfully installed plugin: quota-saver@quota-saver (scope: user)`

Claude Code ke andar se bhi ho sakta hai, steps 2 aur 3 ki jagah:

```
/plugin install quota-saver --marketplace mtrsiddiqui94/quota-saver
```

(`y` dabayein, phir scope `user`.)

## 4. Naya chat / session kholein

VS Code mein Claude ka naya chat kholein, ya terminal mein `claude` chalayein.

## 5. Local model (optional, free sawal)

Pehle session mein sawal aata hai: **"Local model setup karein?"**

- **Haan, sab khud kar do:** plugin khud Ollama install karta hai (Mac par Homebrew, Windows par winget, Linux par install script), model (~2 GB) download karta hai aur local mode on kar deta hai. Progress status line par dikhti hai, aur poora hone par "Local model tayyar!" aata hai.
- **Nahi:** baad mein kabhi bhi `/local on` likhein.

Ye sawal pehle se tay karna ho:

```
claude plugin install quota-saver@quota-saver --config setupLocalModel=yes
```

(`yes` = bina pooche setup, `ask` = poochega (default), `no` = band)

## 6. Check karein

| Likhein | Kya dikhna chahiye |
|---|---|
| `/quota-saver` | `Quota Saver: token bachat` aur `Halat: chalu` |
| `/local` | Ollama aur model ki halat |
| `/yaad test = tests chalao` phir `test` | Shortcut kaam kar raha hai |

## Update

```
claude plugin marketplace update quota-saver
claude plugin update quota-saver@quota-saver
```

## Band / hatana

- Kuch der ke liye band: `/quota-saver off` (wapas: `/quota-saver on`)
- Poora hatana: `claude plugin uninstall quota-saver@quota-saver`

## Masla aaye to

| Masla | Hal |
|---|---|
| `claude: command not found` | Step 1 ka terminal installer chalayein, phir naya terminal kholein |
| `Plugin "quota-saver" not found in marketplace` | `claude plugin marketplace update quota-saver`, phir step 3 |
| Local model "Ollama nahi mila" | `/local on`: plugin khud install karega |
| Local model dheema hai | `/local model qwen2.5:1.5b` (chhota, tez model) |
| Plugin ke commands nazar nahi aa rahe | `/reload-plugins`, ya naya session kholein |
