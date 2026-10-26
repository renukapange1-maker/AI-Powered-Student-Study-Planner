from flask import Flask, jsonify, render_template, request
from pathlib import Path
import sqlite3
import csv

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
DB_PATH = BASE_DIR / 'studyplanner.db'
CSV_PATH = DATA_DIR / 'student_performance.csv'
app = Flask(__name__)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    with get_db() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#7c6cf2',
            target_hours REAL NOT NULL DEFAULT 3,
            mastery INTEGER NOT NULL DEFAULT 50
        );
        CREATE TABLE IF NOT EXISTS study_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject_id INTEGER,
            task_date TEXT NOT NULL DEFAULT (date('now','localtime')),
            duration_minutes INTEGER NOT NULL DEFAULT 30,
            completed INTEGER NOT NULL DEFAULT 0,
            priority TEXT NOT NULL DEFAULT 'Medium',
            FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL
        );
        ''')
        count = db.execute('SELECT COUNT(*) FROM subjects').fetchone()[0]
        if count == 0:
            db.executemany('INSERT INTO subjects(name,color,target_hours,mastery) VALUES(?,?,?,?)', [
                ('Mathematics', '#7968f5', 5, 62),
                ('Computer Science', '#18a999', 6, 78),
                ('Physics', '#f4a340', 4, 43),
                ('English', '#e779a8', 2, 86),
            ])
        count = db.execute('SELECT COUNT(*) FROM study_tasks').fetchone()[0]
        if count == 0:
            subjects = {r['name']: r['id'] for r in db.execute('SELECT id,name FROM subjects')}
            db.executemany('INSERT INTO study_tasks(title,subject_id,task_date,duration_minutes,completed,priority) VALUES(?,?,?,?,?,?)', [
                ('Review quadratic equations', subjects['Mathematics'], '2026-10-22', 45, 0, 'High'),
                ('Practice Python functions', subjects['Computer Science'], '2026-10-22', 40, 1, 'Medium'),
                ('Revise Newton\'s laws', subjects['Physics'], '2026-10-22', 30, 0, 'High'),
                ('Read one comprehension passage', subjects['English'], '2026-10-22', 20, 0, 'Low'),
            ])


@app.route('/')
def home():
    return render_template('index.html')


@app.get('/api/dashboard')
def dashboard():
    with get_db() as db:
        subjects = [dict(r) for r in db.execute('SELECT * FROM subjects ORDER BY id')]
        tasks = [dict(r) for r in db.execute('''SELECT t.*, s.name AS subject_name, s.color AS subject_color
            FROM study_tasks t LEFT JOIN subjects s ON s.id=t.subject_id
            ORDER BY t.task_date, t.id''')]
    today = __import__('datetime').date.today().isoformat()
    today_tasks = [t for t in tasks if t['task_date'] == today]
    # If the current date has no tasks, show the nearest available plan to keep the dashboard useful.
    if not today_tasks and tasks:
        today_tasks = tasks[:4]
    total_minutes = sum(t['duration_minutes'] for t in tasks if t['completed'])
    total_planned = sum(t['duration_minutes'] for t in today_tasks)
    completed_today = sum(t['duration_minutes'] for t in today_tasks if t['completed'])
    avg_mastery = round(sum(s['mastery'] for s in subjects) / len(subjects)) if subjects else 0
    return jsonify({
        'subjects': subjects, 'tasks': tasks, 'today_tasks': today_tasks,
        'total_study_hours': round(total_minutes / 60, 1),
        'average_mastery': avg_mastery,
        'today_progress': round(completed_today / total_planned * 100) if total_planned else 0,
        'subject_count': len(subjects),
        'needs_attention': sorted(subjects, key=lambda s: s['mastery'])[:3]
    })


@app.route('/api/subjects', methods=['GET', 'POST'])
def subjects_api():
    if request.method == 'GET':
        with get_db() as db:
            return jsonify([dict(r) for r in db.execute('SELECT * FROM subjects ORDER BY id')])
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    if not name:
        return jsonify({'error': 'Subject name is required.'}), 400
    try:
        target = float(data.get('target_hours', 3))
        mastery = int(data.get('mastery', 50))
        if target <= 0 or not 0 <= mastery <= 100:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'error': 'Target hours must be positive and mastery must be 0–100.'}), 400
    color = str(data.get('color', '#7c6cf2'))
    try:
        with get_db() as db:
            cur = db.execute('INSERT INTO subjects(name,color,target_hours,mastery) VALUES(?,?,?,?)', (name, color, target, mastery))
            row = db.execute('SELECT * FROM subjects WHERE id=?', (cur.lastrowid,)).fetchone()
            return jsonify(dict(row)), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'A subject with that name already exists.'}), 400


@app.route('/api/subjects/<int:subject_id>', methods=['PUT', 'DELETE'])
def subject_detail(subject_id):
    with get_db() as db:
        row = db.execute('SELECT * FROM subjects WHERE id=?', (subject_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Subject not found.'}), 404
        if request.method == 'DELETE':
            db.execute('DELETE FROM subjects WHERE id=?', (subject_id,))
            return jsonify({'message': 'Subject deleted.'})
        data = request.get_json(silent=True) or {}
        name = str(data.get('name', row['name'])).strip()
        try:
            target = float(data.get('target_hours', row['target_hours']))
            mastery = int(data.get('mastery', row['mastery']))
            if not name or target <= 0 or not 0 <= mastery <= 100:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({'error': 'Enter a subject name, positive target hours and mastery from 0–100.'}), 400
        try:
            db.execute('UPDATE subjects SET name=?,color=?,target_hours=?,mastery=? WHERE id=?',
                       (name, data.get('color', row['color']), target, mastery, subject_id))
            return jsonify(dict(db.execute('SELECT * FROM subjects WHERE id=?', (subject_id,)).fetchone()))
        except sqlite3.IntegrityError:
            return jsonify({'error': 'A subject with that name already exists.'}), 400


@app.route('/api/tasks', methods=['GET', 'POST'])
def tasks_api():
    if request.method == 'GET':
        with get_db() as db:
            rows = db.execute('''SELECT t.*, s.name AS subject_name, s.color AS subject_color
                FROM study_tasks t LEFT JOIN subjects s ON s.id=t.subject_id ORDER BY t.task_date,t.id''')
            return jsonify([dict(r) for r in rows])
    data = request.get_json(silent=True) or {}
    title = str(data.get('title', '')).strip()
    task_date = str(data.get('task_date', '')).strip()
    try:
        duration = int(data.get('duration_minutes', 30))
        if not title or not task_date or duration < 1 or duration > 1440:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({'error': 'Enter a task, date and duration between 1 and 1440 minutes.'}), 400
    subject_id = data.get('subject_id') or None
    try:
        with get_db() as db:
            cur = db.execute('INSERT INTO study_tasks(title,subject_id,task_date,duration_minutes,completed,priority) VALUES(?,?,?,?,?,?)',
                             (title, subject_id, task_date, duration, int(bool(data.get('completed', False))), data.get('priority', 'Medium')))
            row = db.execute('''SELECT t.*,s.name AS subject_name,s.color AS subject_color FROM study_tasks t
                LEFT JOIN subjects s ON s.id=t.subject_id WHERE t.id=?''', (cur.lastrowid,)).fetchone()
            return jsonify(dict(row)), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Selected subject does not exist.'}), 400


@app.route('/api/tasks/<int:task_id>', methods=['PUT', 'DELETE'])
def task_detail(task_id):
    with get_db() as db:
        row = db.execute('SELECT * FROM study_tasks WHERE id=?', (task_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Task not found.'}), 404
        if request.method == 'DELETE':
            db.execute('DELETE FROM study_tasks WHERE id=?', (task_id,))
            return jsonify({'message': 'Task deleted.'})
        data = request.get_json(silent=True) or {}
        title = str(data.get('title', row['title'])).strip()
        task_date = str(data.get('task_date', row['task_date']))
        try:
            duration = int(data.get('duration_minutes', row['duration_minutes']))
            if not title or duration < 1 or duration > 1440:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({'error': 'Task title is required and duration must be 1–1440 minutes.'}), 400
        subject_id = data.get('subject_id', row['subject_id']) or None
        completed = int(bool(data.get('completed', row['completed'])))
        priority = data.get('priority', row['priority'])
        db.execute('UPDATE study_tasks SET title=?,subject_id=?,task_date=?,duration_minutes=?,completed=?,priority=? WHERE id=?',
                   (title, subject_id, task_date, duration, completed, priority, task_id))
        result = db.execute('''SELECT t.*,s.name AS subject_name,s.color AS subject_color FROM study_tasks t
            LEFT JOIN subjects s ON s.id=t.subject_id WHERE t.id=?''', (task_id,)).fetchone()
        return jsonify(dict(result))


@app.get('/api/kaggle-insights')
def kaggle_insights():
    if not CSV_PATH.exists():
        return jsonify({'available': False, 'message': 'CSV not found. Place the Kaggle dataset at data/student_performance.csv.'}), 200
    try:
        with CSV_PATH.open('r', encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            columns = reader.fieldnames or []
            rows = list(reader)
        numeric_stats = {}
        for column in columns:
            vals = []
            for row in rows:
                try:
                    vals.append(float(str(row.get(column, '')).replace(',', '').strip()))
                except (ValueError, TypeError):
                    pass
            if vals and len(vals) >= max(2, len(rows) // 3):
                numeric_stats[column] = round(sum(vals) / len(vals), 2)
        return jsonify({'available': True, 'row_count': len(rows), 'columns': columns,
                        'averages': numeric_stats, 'preview': rows[:8]})
    except Exception as exc:
        return jsonify({'available': False, 'message': f'Could not read CSV: {exc}'}), 400


if __name__ == '__main__':
    init_db()
    app.run(debug=True)
