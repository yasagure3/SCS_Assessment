"""Actual SQLite transaction proof. Not a remote D1 test."""
import sqlite3, pathlib, json
db=sqlite3.connect(':memory:')
db.executescript(pathlib.Path(__file__).with_name('revisions.sql').read_text())
db.execute('INSERT INTO assessments VALUES (?,?,?,?,?,?,?)',('a','c',1,'{"status":"no"}','u','m1','2026-09-18T00:00:00Z'))
sql='UPDATE assessments SET revision=revision+1,document=?,actor_id=?,mutation_id=?,updated_at=? WHERE id=? AND customer_id=? AND revision=?'
args=('{"status":"yes"}','u','m2','2026-09-18T00:01:00Z','a','c',1)
assert db.execute(sql,args).rowcount==1
assert db.execute(sql,('{"status":"no"}','u','m3',args[3],'a','c',1)).rowcount==0
assert db.execute(sql,('{"status":"no"}','u','m4',args[3],'a','other',2)).rowcount==0
assert db.execute('SELECT count(*) FROM assessment_revisions').fetchone()[0]==2
assert json.loads(db.execute('SELECT document FROM assessment_revisions WHERE revision=1').fetchone()[0])['status']=='no'
try:
 db.execute(sql,('{"status":"no"}','u','m1',args[3],'a','c',2))
 raise AssertionError('duplicate mutation was allowed')
except sqlite3.IntegrityError:
 pass
assert db.execute('SELECT revision FROM assessments').fetchone()[0]==2
assert db.execute('SELECT count(*) FROM assessment_revisions').fetchone()[0]==2
print(json.dumps({'checks':8,'passed':8,'engine':sqlite3.sqlite_version,'remoteD1':False}))
