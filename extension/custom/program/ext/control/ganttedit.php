<?php
class program extends control
{
    public function ganttEdit()
    {
        $messages = $this->lang->program->ganttLang;
        if($_SERVER['REQUEST_METHOD'] != 'POST' || empty($_SESSION['programGanttToken'])
            || !is_string($this->post->token) || !hash_equals($_SESSION['programGanttToken'], $this->post->token))
            return $this->send(array('result' => 'fail', 'message' => $messages['denied']));
        if(!is_scalar($this->post->id) || !preg_match('/^[1-9][0-9]*$/D', (string)$this->post->id))
            return $this->send(array('result' => 'fail', 'message' => $messages['denied']));
        foreach(array('type', 'begin', 'end', 'oldBegin', 'oldEnd') as $field)
            if(!is_string($this->post->$field)) return $this->send(array('result' => 'fail', 'message' => $messages['invalidDates']));
        try
        {
            $this->program->loadExtension('programgantt')->saveDates($this->post->type, (int)$this->post->id,
                $this->post->begin, $this->post->end, $this->post->oldBegin, $this->post->oldEnd);
        }
        catch(DomainException $error)
        {
            return $this->send(array('result' => 'fail', 'message' => $error->getMessage()));
        }
        catch(Throwable $error)
        {
            error_log('Program Gantt save: ' . $error);
            return $this->send(array('result' => 'fail', 'message' => $messages['saveFailed']));
        }
        return $this->send(array('result' => 'success', 'message' => $messages['saved']));
    }
}
