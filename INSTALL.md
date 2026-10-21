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

Pehle session mein English mein sawal aata hai: **"Quota Saver: set up a free local model for general questions?"**

- **Yes, set it all up:** plugin khud Ollama install karta hai (Mac par official app, Windows par winget, Linux par install script), model (~1 GB) download karta hai aur local mode on kar deta hai. Har qadam chat mein ek line ki shakal mein dikhta hai (setup ke dauran `/local` likh kar bhi dekh sakte hain), aur poora hone par "Local model is ready!" aata hai.
- **No:** baad mein kabhi bhi `/local on` likhein. Ollama pehle se installed ho to dobara install nahi hota: plugin use dhoond kar seedha chalu kar deta hai.

Ye sawal pehle se tay karna ho:

```
claude plugin install quota-saver@quota-saver --config setupLocalModel=yes
```

(`yes` = bina pooche setup, `ask` = poochega (default), `no` = band)

## 6. Check karein

| Likhein | Kya dikhna chahiye |
|---|---|
| `/quota-saver` | `Quota Saver: token savings` aur `Status: on` |
| `/local` | Ollama aur model ki halat |
| `/shortcut test = tests chalao` phir `test` | Shortcut kaam kar raha hai |
| `/quota-saver audit` | Har request ke saath kya jaata hai aur kya kam kiya ja sakta hai |
| `/quota-saver week` | Pichhle 7 din ki bachat |

## Plugin ko kaam karte dekhna

```
/activity on
```

Ek terminal window khulti hai jis mein har prompt par plugin ka har qadam live dikhta hai: shortcut, cache, local model, roki gayi file reads, chhota kiya gaya output, aur har turn ke asal tokens. Har turn ke baad muqabla bhi aata hai: `used 44.7k tokens · without Quota Saver ≈ 79.5k · saved ≈ 34.8k (44%)`. Band: `/activity off`. Ye default mein band rehta hai, is liye jab nahi dekh rahe to koi bojh nahi.

Window na khule to VS Code terminal mein: `tail -f ~/.quota-saver-activity.log`

## Update

```
claude plugin marketplace update quota-saver
claude plugin update quota-saver@quota-saver
```

## Band karna / disable / uninstall

**1. Kuch der ke liye band (plugin installed rehta hai):**

```
/quota-saver off
```

Sab kuch normal Claude jaisa chalta hai. Wapas chalu: `/quota-saver on`

Sirf local model band karna ho: `/local off`

**2. Disable (installed rehta hai, bilkul load nahi hota):**

```
claude plugin disable quota-saver@quota-saver
```

Wapas: `claude plugin enable quota-saver@quota-saver`

**3. Poora uninstall:**

```
claude plugin uninstall quota-saver@quota-saver
claude plugin marketplace remove quota-saver
```

Pehli line plugin hatati hai, doosri marketplace. Phir naya session kholein.

**4. Ollama bhi hatana ho (optional):** plugin Ollama ko uninstall nahi karta, kyunki wo doosre kaam bhi aa sakta hai.

- Mac (Homebrew): `brew uninstall ollama`, models: `rm -rf ~/.ollama`
- Windows: Settings → Apps → Ollama → Uninstall
- Linux: `sudo rm /usr/local/bin/ollama` (ya `~/.local/bin/ollama`), models: `rm -rf ~/.ollama`

## Masla aaye to

| Masla | Hal |
|---|---|
| `claude: command not found` | Step 1 ka terminal installer chalayein, phir naya terminal kholein |
| `Plugin "quota-saver" not found in marketplace` | `claude plugin marketplace update quota-saver`, phir step 3 |
| Local model "Ollama nahi mila" | `/local on`: plugin khud install karega |
| Local model dheema hai | `/local model gemma3:1b` (aur chhota, tez model) |
| Plugin ke commands nazar nahi aa rahe | `/reload-plugins`, ya naya session kholein |
