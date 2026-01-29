# Icon Generation

The extension requires PNG icons at different sizes. Generate them from the SVG:

## Using ImageMagick

```bash
# Install ImageMagick if needed
# macOS: brew install imagemagick
# Ubuntu: sudo apt install imagemagick

# Generate icons
convert -background none icons/icon.svg -resize 16x16 icons/icon16.png
convert -background none icons/icon.svg -resize 48x48 icons/icon48.png
convert -background none icons/icon.svg -resize 128x128 icons/icon128.png
```

## Using Inkscape

```bash
inkscape --export-type=png --export-width=16 --export-filename=icons/icon16.png icons/icon.svg
inkscape --export-type=png --export-width=48 --export-filename=icons/icon48.png icons/icon.svg
inkscape --export-type=png --export-width=128 --export-filename=icons/icon128.png icons/icon.svg
```

## Online Tools

You can also use online SVG to PNG converters like:
- https://svgtopng.com/
- https://cloudconvert.com/svg-to-png

## Temporary Placeholder

For development, you can create simple placeholder icons:

```bash
# Create colored square placeholders
convert -size 16x16 xc:#0078d4 icons/icon16.png
convert -size 48x48 xc:#0078d4 icons/icon48.png
convert -size 128x128 xc:#0078d4 icons/icon128.png
```
