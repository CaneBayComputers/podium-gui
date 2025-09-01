# Release Process for Podium CLI

## Creating a GitHub Release

### Step 1: Prepare Release Assets
The `.deb` package is stored in `releases/linux/podium-cli_latest.deb` in this repository.

### Step 2: Create GitHub Release
1. Go to GitHub → Releases → "Create a new release"
2. Create a new tag (e.g., `v1.0.0`)
3. **Upload the file directly** as a release asset:
   - Upload `releases/linux/podium-cli_latest.deb`
   - Make sure it's named exactly `podium-cli_latest.deb` in the release

### Step 3: Verify Download URL
After creating the release, the download URL will be:
```
https://github.com/CaneBayComputers/podium-cli/releases/latest/download/podium-cli_latest.deb
```

## Important Notes

- **The file must be uploaded directly to the GitHub release**
- **Don't upload the entire `releases/` folder structure**
- **Just upload the `.deb` file itself as a release asset**
- **The filename in the release must match what's in the README**

## Current Release Structure

```
GitHub Release Assets (what users download):
└── podium-cli_latest.deb

Repository Structure (for development):
releases/
└── linux/
    └── podium-cli_latest.deb
```

The repository structure is for organization, but GitHub releases work with direct file uploads.
