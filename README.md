# Display Shopify prices in ₿ and ƀ (satoshis)

# Setup

**requires my bitcoin price RSS feed to be up and CORS working properly!** otherwise falls back to Coingecko, which will definitely have API limits at any kind of scale

Add these to your theme:

- `assets/bitcoin-display.js`
- `layout/theme.liquid` before ending body tag:
```
    {{ 'bitcoin-display.js' | asset_url | script_tag }}
  </body>
```

# Important Note

Make sure this does not effect the checkout pages, as that might break payment
