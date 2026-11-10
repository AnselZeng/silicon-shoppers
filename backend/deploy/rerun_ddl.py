import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.sf import _snowflake_connect, names

PACKAGES = ("'snowflake-snowpark-python','pandas','numpy','pyarrow','lightgbm',"
            "'scikit-learn','pyyaml','snowflake-ml-python'")
STAGE = "@ATELIER.LIVE.MODELS"

con = _snowflake_connect(names())
cur = con.cursor()
for name, handler in [("REFRESH_SHOPPERS", "jobs.refresh_shoppers"),
                      ("RETRAIN_INTEREST", "jobs.retrain_interest")]:
    cur.execute(f"""
CREATE OR REPLACE PROCEDURE {name}()
RETURNS STRING
LANGUAGE PYTHON RUNTIME_VERSION = '3.12'
PACKAGES = ({PACKAGES})
IMPORTS = ('{STAGE}/pkg.zip')
HANDLER = '{handler}'
""")
    print(name, "recreated on 3.12")
con.close()
