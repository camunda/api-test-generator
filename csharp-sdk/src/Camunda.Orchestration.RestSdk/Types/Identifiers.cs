namespace Camunda.Orchestration.RestSdk.Types;

public readonly record struct ProcessInstanceKey(string Value)
{
    public static implicit operator ProcessInstanceKey(string value) => new(value);
    public static implicit operator string(ProcessInstanceKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct ProcessDefinitionId(string Value)
{
    public static implicit operator ProcessDefinitionId(string value) => new(value);
    public static implicit operator string(ProcessDefinitionId value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct ProcessDefinitionKey(string Value)
{
    public static implicit operator ProcessDefinitionKey(string value) => new(value);
    public static implicit operator string(ProcessDefinitionKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct JobKey(string Value)
{
    public static implicit operator JobKey(string value) => new(value);
    public static implicit operator string(JobKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct ElementInstanceKey(string Value)
{
    public static implicit operator ElementInstanceKey(string value) => new(value);
    public static implicit operator string(ElementInstanceKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct ElementId(string Value)
{
    public static implicit operator ElementId(string value) => new(value);
    public static implicit operator string(ElementId value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct UserTaskKey(string Value)
{
    public static implicit operator UserTaskKey(string value) => new(value);
    public static implicit operator string(UserTaskKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct DecisionDefinitionKey(string Value)
{
    public static implicit operator DecisionDefinitionKey(string value) => new(value);
    public static implicit operator string(DecisionDefinitionKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct DecisionDefinitionId(string Value)
{
    public static implicit operator DecisionDefinitionId(string value) => new(value);
    public static implicit operator string(DecisionDefinitionId value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct DecisionRequirementsKey(string Value)
{
    public static implicit operator DecisionRequirementsKey(string value) => new(value);
    public static implicit operator string(DecisionRequirementsKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct FormKey(string Value)
{
    public static implicit operator FormKey(string value) => new(value);
    public static implicit operator string(FormKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct FormId(string Value)
{
    public static implicit operator FormId(string value) => new(value);
    public static implicit operator string(FormId value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct DeploymentKey(string Value)
{
    public static implicit operator DeploymentKey(string value) => new(value);
    public static implicit operator string(DeploymentKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct ResourceKey(string Value)
{
    public static implicit operator ResourceKey(string value) => new(value);
    public static implicit operator string(ResourceKey value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct TenantId(string Value)
{
    public static implicit operator TenantId(string value) => new(value);
    public static implicit operator string(TenantId value) => value.Value;
    public override string ToString() => Value;
}

public readonly record struct BusinessId(string Value)
{
    public static implicit operator BusinessId(string value) => new(value);
    public static implicit operator string(BusinessId value) => value.Value;
    public override string ToString() => Value;
}
