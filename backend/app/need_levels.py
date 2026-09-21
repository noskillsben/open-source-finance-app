"""The need-level scale (DESIGN.md § Need levels): a fixed ordinal, not a table. The order is
what makes it reportable and a sort key on the pay screen. Plain strings in the database; this
is the one list of valid values.
"""

NEED_LEVELS: tuple[str, ...] = ("need", "should", "nice_to_have", "want")
