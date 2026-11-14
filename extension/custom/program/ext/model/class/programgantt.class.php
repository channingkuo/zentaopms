<?php
declare(strict_types=1);

/** Independent program Gantt extension. Licensed under AGPL-3.0-or-later. */
class programganttProgram extends programModel
{
    private array $scopedUsers = array();
    /** Return only fields needed by the chart, after applying each object's ACL. */
    public function getData(int $programID = 0): array
    {
        $this->requireProgramFeature();
        if(!common::hasPriv('program', 'gantt')) throw new DomainException($this->lang->program->ganttLang['denied']);
        $objects = $this->dao->select('id,parent,project,path,type,name,status,begin,end,PM,progress,multiple,frozen,vision,isTpl,openedBy,lastEditedBy,closedBy,canceledBy')
            ->from(TABLE_PROJECT)->where('deleted')->eq(0)->andWhere('vision')->eq($this->config->vision)
            ->andWhere('isTpl')->eq(0)->orderBy('order_asc,id_asc')->fetchAll('id');
        if($programID && (!isset($objects[$programID]) || $objects[$programID]->type != 'program' || !$this->canView($objects[$programID])))
            throw new DomainException($this->lang->program->ganttLang['denied']);

        $nodes = $projectIDs = $executionIDs = array();
        foreach($objects as $object)
        {
            if(!in_array($object->type, array('program', 'project')) || !$this->canView($object)) continue;
            if($programID && strpos($object->path, ",$programID,") === false) continue;
            $nodes['p' . $object->id] = $this->toNode($object);
            if($object->type == 'project') $projectIDs[] = $object->id;
        }
        foreach($objects as $object)
        {
            if(!in_array($object->type, array('sprint', 'stage', 'kanban')) || !in_array($object->project, $projectIDs) || !$this->canView($object)) continue;
            $executionIDs[] = $object->id;
            /* Single-execution projects have a hidden implementation sprint. */
            if(!$object->multiple) continue;
            $nodes['p' . $object->id] = $this->toNode($object);
        }
        $tasks = $this->dao->select('id,parent,project,execution,name,status,estStarted,deadline,assignedTo,consumed,`left`,path,openedBy,lastEditedBy,finishedBy,closedBy,canceledBy')
            ->from(TABLE_TASK)->where('deleted')->eq(0)->andWhere('isTpl')->eq(0)
            ->andWhere('project')->in($projectIDs)->andWhere('execution')->in($executionIDs)
            ->orderBy('id_asc')->fetchAll('id');
        foreach($tasks as $task)
        {
            $nodes['t' . $task->id] = $this->toNode($task, 'task');
            if(!empty($objects[$task->execution]->frozen)) $nodes['t' . $task->id]['editable'] = false;
        }

        /* Never serialize the names, IDs or paths of inaccessible ancestors. */
        foreach($nodes as $key => &$node)
        {
            $record = $node['type'] == 'task' ? $tasks[$node['objectID']] : $objects[$node['objectID']];
            $parent = $node['type'] == 'task' ? ($record->parent > 0 ? 't' . $record->parent : 'p' . $record->execution) : 'p' . $record->parent;
            if($parent == $key || !isset($nodes[$parent]))
            {
                $parent = '';
                $path = array_reverse(array_filter(explode(',', (string)$record->path)));
                foreach($path as $id)
                {
                    $candidate = ($node['type'] == 'task' ? 't' : 'p') . $id;
                    if($candidate != $key && isset($nodes[$candidate])) { $parent = $candidate; break; }
                }
                if(!$parent && $node['type'] == 'task' && isset($nodes['p' . $record->execution])) $parent = 'p' . $record->execution;
                if(!$parent && isset($nodes['p' . $record->project])) $parent = 'p' . $record->project;
            }
            $node['parent'] = $parent;
        }
        unset($node);

        $accounts = array_unique(array_filter(array_column($nodes, 'owner')));
        $users = $this->dao->select('account,realname')->from(TABLE_USER)->where('account')->in($accounts)->fetchPairs();
        foreach($nodes as &$node) $node['owner'] = $users[$node['owner']] ?? $node['owner'];
        unset($node);
        return array_values($nodes);
    }

    private function requireProgramFeature(): void
    {
        if(($this->config->systemMode ?? '') === 'light' || !helper::hasFeature('program'))
            throw new DomainException($this->lang->program->ganttLang['featureDisabled']);
    }

    private function canView(object $object): bool
    {
        if($object->type == 'program') return $this->checkPriv((int)$object->id);
        if($object->type == 'project') return $this->loadModel('project')->checkPriv((int)$object->id);
        return $this->loadModel('execution')->checkPriv((int)$object->id);
    }

    private function canEdit(object $object, string $type): bool
    {
        $module = $type == 'task' ? 'task' : ($object->type == 'program' ? 'program' : ($object->type == 'project' ? 'project' : 'execution'));
        if(!common::hasPriv('program', 'ganttEdit') || in_array($object->status, array('closed', 'done', 'cancel')) || !empty($object->frozen)) return false;
        $user = $this->app->user;
        $tab  = $this->app->tab;
        try
        {
            /* Honor project groups that replace (auth=reset) or extend global rights. */
            $projectID = $type == 'project' ? (int)$object->id : ($type == 'program' ? 0 : (int)$object->project);
            if($projectID && !$user->admin)
            {
                if(!isset($this->scopedUsers[$projectID]))
                {
                    $this->app->tab = 'project';
                    $this->loadModel('common')->resetProjectPriv($projectID);
                    $this->scopedUsers[$projectID] = $this->app->user;
                }
                $this->app->user = $this->scopedUsers[$projectID];
            }
            if(!common::hasDBPriv($object, $module, 'edit')) return false;
            $context = clone $object;
            /* The framework's execution-admin check expects the execution ID. */
            if($type == 'task') $context->id = $object->execution;
            return common::hasPriv($module, 'edit', $context);
        }
        finally
        {
            $this->app->user = $user;
            $this->app->tab = $tab;
        }
    }

    public static function normalizeDate(?string $date): string
    {
        if(!$date || $date < '1900-01-01' || $date >= '2100-01-01') return '';
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        return $parsed && $parsed->format('Y-m-d') == $date ? $date : '';
    }

    private function toNode(object $object, string $type = ''): array
    {
        if(!$type) $type = in_array($object->type, array('program', 'project')) ? $object->type : 'execution';
        $begin = $type == 'task' ? $object->estStarted : $object->begin;
        $end   = $type == 'task' ? $object->deadline : $object->end;
        $total = $type == 'task' ? (float)$object->consumed + (float)$object->left : 0;
        $progress = $type == 'task' ? ($total > 0 ? round(100 * $object->consumed / $total) : ($object->status == 'done' ? 100 : 0)) : (float)$object->progress;
        return array('id' => ($type == 'task' ? 't' : 'p') . $object->id, 'objectID' => (int)$object->id,
            'type' => $type, 'name' => $object->name, 'status' => $object->status,
            'begin' => self::normalizeDate($begin), 'end' => self::normalizeDate($end),
            'owner' => $type == 'task' ? $object->assignedTo : $object->PM, 'progress' => max(0, min(100, $progress)),
            'editable' => $this->canEdit($object, $type));
    }

    /** Update one object's dates only. Parents and children are never moved implicitly. */
    public function saveDates(string $type, int $id, string $begin, string $end, string $oldBegin, string $oldEnd): bool
    {
        $this->requireProgramFeature();
        $messages = $this->lang->program->ganttLang;
        if(!common::hasPriv('program', 'gantt') || !common::hasPriv('program', 'ganttEdit')) throw new DomainException($messages['denied']);
        if(!in_array($type, array('program', 'project', 'execution', 'task')) || $id <= 0) throw new DomainException($messages['denied']);
        if(!self::normalizeDate($begin) || !self::normalizeDate($end) || $begin > $end) throw new DomainException($messages['invalidDates']);

        $table = $type == 'task' ? TABLE_TASK : TABLE_PROJECT;
        $this->dao->begin();
        try
        {
            /* Lock the record so two charts cannot both accept the same old dates. */
            $object = $this->dao->dbh->query("SELECT * FROM $table WHERE id = " . (int)$id . ' FOR UPDATE')->fetch(PDO::FETCH_OBJ);
            if(!$object || $object->deleted || !empty($object->isTpl)) throw new DomainException($messages['denied']);
            $actualType = $type == 'task' ? 'task' : (in_array($object->type, array('program', 'project')) ? $object->type : 'execution');
            if($actualType != $type) throw new DomainException($messages['denied']);
            if($type == 'task')
            {
                $project   = $this->loadModel('project')->fetchByID((int)$object->project);
                $execution = $this->loadModel('execution')->fetchByID((int)$object->execution);
                if(!$project || !$execution || $project->deleted || $execution->deleted || $project->vision != $this->config->vision
                    || !empty($execution->frozen) || !$this->canView($project) || !$this->canView($execution)) throw new DomainException($messages['denied']);
            }
            else
            {
                if($object->vision != $this->config->vision || !$this->canView($object)) throw new DomainException($messages['denied']);
                if($type == 'execution')
                {
                    $project = $this->loadModel('project')->fetchByID((int)$object->project);
                    if(!$project || $project->deleted || !$this->canView($project)) throw new DomainException($messages['denied']);
                }
            }
            if(!$this->canEdit($object, $type)) throw new DomainException($messages['denied']);
            $beginField = $type == 'task' ? 'estStarted' : 'begin';
            $endField   = $type == 'task' ? 'deadline' : 'end';
            if(self::normalizeDate($object->$beginField) !== $oldBegin || self::normalizeDate($object->$endField) !== $oldEnd)
                throw new DomainException($messages['conflict']);
            $this->validateBounds($object, $type, $begin, $end);
            if($begin == $oldBegin && $end == $oldEnd) { $this->dao->commit(); return true; }

            if($type == 'task')
            {
                /* Reuse the task model's date-only update, workflow checks and action history. */
                $saved = $this->loadModel('task')->updateEsDateByGantt((object)array('id' => $id, 'type' => 'task', 'startDate' => $begin,
                    'endDate' => (new DateTimeImmutable($end))->modify('+1 day')->format('Y-m-d')));
                if(!$saved || dao::isError()) throw new DomainException($messages['saveFailed']);
            }
            else
            {
                $data = (object)array('begin' => $begin, 'end' => $end, 'lastEditedBy' => $this->app->user->account, 'lastEditedDate' => helper::now());
                if(!empty($object->schedule))
                {
                    $schedule = $this->loadModel('project')->computeSchedule($begin, $end, json_decode($object->schedule, true));
                    $data->schedule = json_encode($schedule);
                    $data->days = count($schedule->calendar ?? array());
                }
                $this->dao->update(TABLE_PROJECT)->data($data)->autoCheck()->checkFlow()->where('id')->eq($id)->exec();
                if(dao::isError()) throw new DomainException($messages['saveFailed']);
                /* The hidden sprint of a single-execution project always shares its project dates. */
                if($type == 'project' && !$object->multiple)
                {
                    $this->dao->update(TABLE_PROJECT)->data($data)->where('project')->eq($id)->andWhere('type')->in('sprint,kanban')
                        ->andWhere('multiple')->eq(0)->andWhere('deleted')->eq(0)->exec();
                }
                $changes = common::createChanges($object, $data);
                $actionID = $this->loadModel('action')->create($type, $id, 'edited');
                if($actionID) $this->action->logHistory($actionID, $changes);
                if(dao::isError()) throw new DomainException($messages['saveFailed']);
            }
            $this->dao->commit();
            return true;
        }
        catch(Throwable $error)
        {
            if($this->dao->inTransaction()) $this->dao->rollBack();
            throw $error;
        }
    }

    /** Check all bounds, including hidden children, without disclosing their details. */
    private function validateBounds(object $object, string $type, string $begin, string $end): void
    {
        $bounds = array();
        if($type == 'task')
        {
            $project = $this->loadModel('project')->fetchByID((int)$object->project);
            if($project->taskDateLimit == 'limit')
            {
                $bounds = $this->dao->select('estStarted AS begin,deadline AS end')->from(TABLE_TASK)
                    ->where('id')->in(array_filter(explode(',', (string)$object->path)))->andWhere('id')->ne($object->id)->andWhere('deleted')->eq(0)->fetchAll();
                $bounds[] = $this->dao->select('begin,end')->from(TABLE_PROJECT)->where('id')->eq($object->execution)->fetch();
                $bounds[] = $project;
                $children = $this->dao->select('estStarted AS begin,deadline AS end')->from(TABLE_TASK)
                    ->where('parent')->eq($object->id)->andWhere('deleted')->eq(0)->fetchAll();
                $this->checkChildren($children, $begin, $end);
            }
        }
        else
        {
            if($object->parent) $bounds[] = $this->dao->select('begin,end')->from(TABLE_PROJECT)->where('id')->eq($object->parent)->andWhere('deleted')->eq(0)->fetch();
            $children = $this->dao->select('begin,end')->from(TABLE_PROJECT)->where('parent')->eq($object->id)->andWhere('deleted')->eq(0)
                ->beginIF($type == 'project' && !$object->multiple)->andWhere('multiple')->ne(0)->fi()->fetchAll();
            $this->checkChildren($children, $begin, $end);
            if($type == 'execution' || ($type == 'project' && !$object->multiple))
            {
                $project = $type == 'project' ? $object : $this->loadModel('project')->fetchByID((int)$object->project);
                if($project->taskDateLimit == 'limit')
                {
                    $tasks = $this->dao->select('estStarted AS begin,deadline AS end')->from(TABLE_TASK)->where('deleted')->eq(0)
                        ->beginIF($type == 'project')->andWhere('project')->eq($object->id)->fi()
                        ->beginIF($type == 'execution')->andWhere('execution')->eq($object->id)->fi()->fetchAll();
                    $this->checkChildren($tasks, $begin, $end);
                }
            }
        }
        foreach($bounds as $bound)
        {
            if(!$bound) continue;
            $start = self::normalizeDate($bound->begin);
            $finish = self::normalizeDate($bound->end);
            if(($start && $begin < $start) || ($finish && $end > $finish)) throw new DomainException($this->lang->program->ganttLang['bounds']);
        }
    }

    private function checkChildren(array $children, string $begin, string $end): void
    {
        foreach($children as $child)
        {
            $start = self::normalizeDate($child->begin);
            $finish = self::normalizeDate($child->end);
            if(($start && $begin > $start) || ($finish && $end < $finish)) throw new DomainException($this->lang->program->ganttLang['bounds']);
        }
    }
}
