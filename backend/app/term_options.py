"""The closed lists a lender's terms choose from (DESIGN.md § Debt terms). Plain strings in the
database; these are the one place each list of valid values lives. The minimum-payment rule is
free text and has no list.
"""

COMPOUNDING_RULES = ("daily", "monthly", "semi-annual")
PREPAYMENT_MODELS = ("open", "closed with privileges", "penalty")
