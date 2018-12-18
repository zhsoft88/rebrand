# rebrand
Node.js based chromium devtools for rebranding chromium

## Installation

```sh
$ [sudo] npm install -g rebrand
```

## Usage

```
Usage:
  rebrand [OPTIONS] [config_dir]

Options:
  -h, --help: Help
  -v, --version : Version
  -c DIR, --chrome_src=DIR : Chromium source dir

Arguments:
config_dir : configuration directory
```

## In config_dir

### BRANDING

The file will override chrome/app/theme/chromium/BRANDING

### BRANDING_&lt;lang&gt;

Use these language specific branding info for corresponding xtb files

### grd_files.txt

Grd files that needs replacing branding info

### grd_filter.map

Branding replace map for grd files

### grd_reserved.txt

Reserved keywords for grd files

### src_files.txt

Source files that needs replacing branding info

### src_filter.map

Branding replace map for source files

### res

Files in this dir will overwrite same files in chrome_src dir
