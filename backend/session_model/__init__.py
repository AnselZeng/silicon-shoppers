"""Live session model: predicts a shopper's browsing style from their first few events on the site.

Trained on OTTO (12.9M real shopping sessions): observe a shopper's first N events, predict how they browse over
their later events. Exported as JSON trees + a dependency-free JavaScript runtime (web/) so the demo app can
adapt browsing-driven UI to the visitor's own clicks. Run from the repo root: python -m session_model --help
"""
