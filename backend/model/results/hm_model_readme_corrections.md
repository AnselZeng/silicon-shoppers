# Suggested corrections for the h&m-model branch README

From the 2026-10-14 review; numbers from `model/results/` on the `model` branch.

1. **Product ranking (Option 5).**
   - Replace: "Each final shopper's purchased in-assortment articles are mixed with 100 random in-assortment articles. The model ranks what they actually bought higher than popularity alone does." and the AUC / Recall@10 table.
   - With: "Measured against real candidates (MAP@12, the H&M competition metric) on the clean 2019 test: ranker 0.0202, 'previous purchases + this week's popular' 0.0126, 'this week's popular' 0.0044. With already-bought products hidden: 0.0061 vs 0.0040. The earlier 62.2% vs 52.7% Recall@10 used 100 random negatives, which are easy to beat, so it overstated the gain."

2. **Quick access.**
   - Replace "Baby & Kids tile: 19.5% buy baby next month vs 4.3% of everyone (4.5x)" in the results column.
   - With: "Targeting check: tile holders buy baby next month at 19.5% vs 4.3% overall (4.5×). This shows the tile reaches the right shoppers; it is not a measured effect of the tile."

3. **Category order.**
   - Add: "Not confirmed on the reserved 2019 test: the merged model's category order gained +0.0007 [−0.0006, +0.0021], with Hit@1 0.680 vs 0.690."

4. **Color highlight.** Keep the changed-shopper count next to every gain (as in "338 highlighted"), including the dev numbers.
