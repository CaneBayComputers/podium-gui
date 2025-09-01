# Simple Homebrew Formula for Podium CLI

This is a **simple Homebrew formula** that users can install directly without needing a tap.

## For Users (macOS Installation)

```bash
# Download and install the formula
curl -O https://raw.githubusercontent.com/CaneBayComputers/podium-cli/main/releases/homebrew/podium-cli.rb
brew install --formula ./podium-cli.rb
```

That's it! No tap setup required.

## What This Does

- **Downloads** the Podium CLI source code
- **Installs dependencies** (Docker, Git, Curl, jq) via Homebrew
- **Runs the install script** automatically
- **Creates symlinks** so `podium` command works globally
- **Shows helpful tips** about Docker and getting started

## For Maintainers

### Updating the Formula

When releasing a new version:

1. **Update the `url`** to point to the new release tag
2. **Update the `version`** number
3. **Calculate SHA256** of the new tarball:
   ```bash
   curl -sL https://github.com/CaneBayComputers/podium-cli/archive/refs/tags/v1.0.0.tar.gz | shasum -a 256
   ```
4. **Update the `sha256`** in the formula
5. **Test locally**:
   ```bash
   brew install --formula ./podium-cli.rb
   ```

### Why This Approach?

- **No tap required** - users don't need to add a custom tap
- **Simple maintenance** - just one `.rb` file to update
- **Professional installation** - handles dependencies automatically
- **Easy distribution** - users download directly from GitHub
