import numpy as np
import pandas as pd
import pytest

from atelier_data import evaluate
from atelier_data.config import read_json


def layouts(built):
    vocab = read_json(built.paths.processed / "vocabularies.json")
    prof = pd.read_parquet(built.paths.processed / "profiles_dev_Eall.parquet")
    n = len(prof)
    df = pd.DataFrame({
        "customer_key": prof["customer_key"],
        "landing_department": [vocab["department_keys"][0]] * n,
        "category_order": [list(vocab["category_keys"])] * n,
        "section_order": [["new_in", "sale", "bestsellers", "buy_again"]] * n,
        "default_sort": ["bestsellers"] * n,
        "color_highlight": [[]] * n,
    })
    return df, prof, vocab


def test_valid_layouts(built):
    df, prof, vocab = layouts(built)
    L = evaluate.layouts_to_decisions(built, df.sample(frac=1, random_state=0), prof, vocab)  # any row order
    assert (L["sort"] == evaluate.SORTS.index("bestsellers")).all() and not L["color_on"].any()
    assert (L["cat_order"] == np.arange(len(vocab["category_keys"]))).all()


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d.iloc[1:], "cohort shoppers have no layout"),
    (lambda d: pd.concat([d, d.iloc[:1]]), "appear more than once"),
    (lambda d: d.assign(default_sort=["cheapest"] + list(d["default_sort"].iloc[1:])), "invalid default_sort"),
    (lambda d: d.assign(landing_department="dept_nope"), "invalid landing_department"),
    (lambda d: d.assign(category_order=[d["category_order"].iloc[0][:-1]] * len(d)), "invalid category_order"),
    (lambda d: d.assign(section_order=[["sale", "sale", "new_in", "buy_again"]] * len(d)), "invalid section_order"),
    (lambda d: d.assign(color_highlight=[["Plaid"]] * len(d)), "invalid color_highlight"),
    (lambda d: d.drop(columns=["default_sort"]), "missing columns"),
])
def test_invalid_layouts_fail_clearly(built, mutate, message):
    df, prof, vocab = layouts(built)
    with pytest.raises(evaluate.LayoutError, match=message):
        evaluate.layouts_to_decisions(built, mutate(df), prof, vocab)
